import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __clearErailCaches, erailAdapter, parseErailTbs } from "@/providers/adapters/erail-v1";
import type { QueryContext } from "@/providers/types";
import { envelopeContractViolations } from "../../contract/contract-suite";

const ctx: QueryContext = { locale: "en", requestId: "req-e" };

const TBS_BODY = [
  "12951\tMUMBAI RAJDHANI\tLUDHIANA JN\tLDH\t01:10\tNEW DELHI\tNDLS\t04:55\t03:45\t329\t3A,SL\t1234567",
  "12013\tSHATABDI EXP\tLUDHIANA JN\tLDH\t19:43\tNEW DELHI\tNDLS\t22:55\t03:12\t329\tCC,EC\t1234567",
  "garbage line without tabs",
].join("\n");

beforeEach(() => {
  __clearErailCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __clearErailCaches();
});

describe("erail-v1 — TBS parsing", () => {
  it("parses tab-separated rows and drops garbage", () => {
    const { trains, throttled } = parseErailTbs(TBS_BODY);
    expect(throttled).toBe(false);
    expect(trains).toHaveLength(2);
    expect(trains[0]).toMatchObject({
      trainNumber: "12951",
      trainName: "MUMBAI RAJDHANI",
      from: { code: "LDH", name: "LUDHIANA JN" },
      to: { code: "NDLS", name: "NEW DELHI" },
      departure: "01:10",
      arrival: "04:55",
      classes: ["3A", "SL"],
    });
  });

  it("recognises the throttle response", () => {
    const { trains, throttled } = parseErailTbs("~~~~~Please try again after some time.");
    expect(throttled).toBe(true);
    expect(trains).toEqual([]);
  });
});

describe("erail-v1 — search", () => {
  it("maps a live-style response into an ok envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, text: async () => TBS_BODY }) as unknown as Response),
    );
    const env = await erailAdapter.search({ from: "LDH", to: "NDLS", date: "2026-10-12" }, ctx);
    expect(env.data).toHaveLength(2);
    expect(env.source.providerId).toBe("erail-v1");
    expect(envelopeContractViolations(env)).toEqual([]);
  });

  it("maps throttling to a retryable RATE_LIMITED error — never fabricated trains", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({ ok: true, status: 200, text: async () => "~~~~~Please try again after some time." }) as unknown as Response,
      ),
    );
    const env = await erailAdapter.search({ from: "LDH", to: "NDLS", date: "2026-10-12" }, ctx);
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("RATE_LIMITED");
    expect(env.errors[0].retryable).toBe(true);
  });

  it("refuses station NAMES honestly (it has no lookup) instead of guessing codes", async () => {
    const env = await erailAdapter.search({ from: "Ludhiana", to: "Delhi", date: "2026-10-12" }, ctx);
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("VALIDATION_FAILED");
  });

  it("empty/unparsable body → retryable UPSTREAM_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, text: async () => "nothing useful" }) as unknown as Response),
    );
    const env = await erailAdapter.search({ from: "LDH", to: "NDLS", date: "2026-10-12" }, ctx);
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("UPSTREAM_ERROR");
  });
});
