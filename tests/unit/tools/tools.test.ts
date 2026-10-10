import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { executeTool, type ToolExecutionMeta } from "@/assistant/tools/executor";
import { TOOL_ARG_SCHEMAS, TOOL_DEFINITIONS, ToolNames } from "@/assistant/tools/schemas";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type { ResultEnvelope, SeatAvailabilityProvider } from "@/providers/types";

const meta: ToolExecutionMeta = {
  conversationId: "conv-1",
  turnId: "t-1",
  toolCallId: "call-1",
};

describe("tool definitions ↔ zod validation stay in sync", () => {
  for (const def of TOOL_DEFINITIONS) {
    it(`${def.function.name} JSON schema matches its zod schema`, () => {
      const schema = TOOL_ARG_SCHEMAS[def.function.name as keyof typeof TOOL_ARG_SCHEMAS];
      expect(schema).toBeDefined();
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const zodKeys = Object.keys(shape).sort();
      const jsonKeys = Object.keys(def.function.parameters.properties as object).sort();
      expect(jsonKeys).toEqual(zodKeys);
      const required = (def.function.parameters.required as string[] | undefined) ?? [];
      if (required.length > 0) {
        // Parsing an empty object must complain about every required key.
        const empty = schema.safeParse({});
        expect(empty.success).toBe(false);
        const missingPaths = empty.success
          ? []
          : empty.error.issues.map((i) => String(i.path[0]));
        for (const key of required) {
          expect(missingPaths).toContain(key);
        }
      }
    });
  }

  it("exposes exactly the 9 required tools", () => {
    expect(TOOL_DEFINITIONS.map((d) => d.function.name).sort()).toEqual(
      Object.values(ToolNames).sort(),
    );
  });

  it("exposes NO booking/payment/ticket-issuance tools (booking stays disabled)", () => {
    for (const def of TOOL_DEFINITIONS) {
      expect(def.function.name).not.toMatch(/BOOK|PAY|ISSUE|OTP|PASSENGER_SUBMIT/i);
    }
  });
});

describe("executeTool — validation boundary (never executes invalid args)", () => {
  it("rejects a non-ISO date before any provider call", async () => {
    const result = await executeTool(
      "SEARCH_TRAINS",
      { from: "LDH", to: "NDLS", date: "tomorrow" },
      undefined,
      meta,
    );
    expect(result.status).toBe("invalid_arguments");
    expect(result.note).toContain("Validation failed");
    expect(result.correlationId).toBe("conv-1:t-1:call-1");
  });

  it("rejects a 9-digit PNR", async () => {
    const result = await executeTool("CHECK_PNR", { pnr: "123456789" }, undefined, meta);
    expect(result.status).toBe("invalid_arguments");
    expect(result.note).toContain("pnr");
  });

  it("handles unparseable model arguments (args:null) honestly", async () => {
    const result = await executeTool("SEARCH_TRAINS", null, "{'from':", meta);
    expect(result.status).toBe("invalid_arguments");
    expect(result.note).toContain("unparseable");
  });

  it("coerces model-emitted numeric PNR/trainNumber to string, then enforces the regex", async () => {
    // Regression from live smoke: models emit {"pnr":1234567890} as a JSON number.
    const coerced = await executeTool("CHECK_PNR", { pnr: 1234567890 }, undefined, meta);
    expect(coerced.status).toBe("not_configured"); // passed validation, hit honest provider gap
    const stillInvalid = await executeTool("CHECK_PNR", { pnr: 12345 }, undefined, meta);
    expect(stillInvalid.status).toBe("invalid_arguments");
    const train = await executeTool("GET_TRAIN_INFO", { trainNumber: 12951 }, undefined, meta);
    expect(train.status).toBe("not_configured");
  });
});

describe("executeTool — honest provider states", () => {
  afterEach(() => {
    unregisterAdapter("avail-fixture");
    delete process.env.RAILWAY_PROVIDER_IDS;
    delete process.env.RAILWAY_PROVIDER_AVAIL_FIXTURE_KEY;
  });

  it("maps the not-configured state to status=not_configured with anti-fabrication note", async () => {
    const result = await executeTool(
      "SEARCH_TRAINS",
      { from: "LDH", to: "NDLS", date: "2026-10-11" },
      undefined,
      meta,
    );
    expect(result.status).toBe("not_configured");
    expect(result.note).toContain("Do NOT invent");
    expect(result.data).toBeUndefined();
  });

  it("treats RAC/WL as VALID outcomes (status ok), not technical failures", async () => {
    const availability: SeatAvailabilityProvider = {
      id: "avail-fixture",
      capabilities: ["seatAvailability"],
      termsRef: "docs/provider-terms.md#avail-fixture",
      async health() {
        return { ok: true, latencyMs: 1, errors: [] };
      },
      async availability(q, ctx): Promise<ResultEnvelope<never>> {
        return okEnvelope({
          data: {
            trainNumber: q.trainId,
            date: q.date,
            from: { code: "LDH", name: "Ludhiana" },
            to: { code: "NDLS", name: "New Delhi" },
            classes: [
              { classCode: "3A", status: "RAC 12", seatsText: "RAC 12" },
              { classCode: "SL", status: "WL 45", seatsText: "WL 45" },
            ],
          },
          source: {
            providerId: "avail-fixture",
            kind: "official-api",
            termsRef: "docs/provider-terms.md#avail-fixture",
            authorization: "configured",
          },
          ttlSeconds: 120,
          requestId: ctx.requestId,
        }) as ResultEnvelope<never>;
      },
    };
    registerAdapter(availability);
    process.env.RAILWAY_PROVIDER_IDS = "avail-fixture";
    process.env.RAILWAY_PROVIDER_AVAIL_FIXTURE_KEY = "fixture-cred";

    const result = await executeTool(
      "CHECK_AVAILABILITY",
      { trainNumber: "12951", date: "2026-10-11", from: "LDH", to: "NDLS" },
      undefined,
      meta,
    );
    expect(result.status).toBe("ok"); // RAC/WL are valid results, NOT errors
    expect(result.errors ?? []).toEqual([]);
    const data = result.data as { classes: { status: string }[] };
    expect(data.classes.map((c) => c.status)).toEqual(["RAC 12", "WL 45"]);
    expect(result.journeyDate).toBe("2026-10-11");
    expect(result.source?.providerId).toBe("avail-fixture");
  });

  it("GENERAL_RAILWAY_ANSWER makes no provider call and labels provenance", async () => {
    const result = await executeTool(
      "GENERAL_RAILWAY_ANSWER",
      { question: "WL ka matlab?", language: "hinglish" },
      undefined,
      meta,
    );
    expect(result.status).toBe("ok");
    expect((result.data as { kind: string }).kind).toBe("general_knowledge");
    expect(result.source).toBeUndefined(); // no provider involved
  });

  it("correlationId ties result → conversation/turn/tool-call", async () => {
    const result = await executeTool(
      "CHECK_PNR",
      { pnr: "1234567890" },
      undefined,
      { conversationId: "cid-9", turnId: "turn-9", toolCallId: "call-9" },
    );
    expect(result.correlationId).toBe("cid-9:turn-9:call-9");
  });
});
