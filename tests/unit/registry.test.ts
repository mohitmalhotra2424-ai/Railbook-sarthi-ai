import { afterEach, describe, expect, it } from "vitest";
import { okEnvelope } from "@/providers/envelope";
import {
  capabilityStatus,
  executeCapability,
  registerAdapter,
  resolveProviders,
  unregisterAdapter,
} from "@/providers/registry";
import type { SourceInfo, TrainSearchProvider, TrainSummary } from "@/providers/types";

function summaryOf(trainNumber: string, departure: string): TrainSummary {
  return {
    trainNumber,
    trainName: `Fixture Express ${trainNumber}`,
    from: { code: "NDLS", name: "New Delhi" },
    to: { code: "BCT", name: "Mumbai Central" },
    departure,
    arrival: "08:35",
  };
}

function makeSearchAdapter(id: string, rows: TrainSummary[]): TrainSearchProvider {
  const source: SourceInfo = {
    providerId: id,
    kind: "official-api",
    termsRef: `docs/provider-terms.md#${id}`,
    authorization: "configured",
  };
  return {
    id,
    capabilities: ["trainSearch"],
    termsRef: `docs/provider-terms.md#${id}`,
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async search(_q, ctx) {
      return okEnvelope({ data: rows, source, ttlSeconds: 300, requestId: ctx.requestId });
    },
  };
}

describe("registry", () => {
  afterEach(() => {
    unregisterAdapter("fixture-a");
    unregisterAdapter("fixture-b");
    delete process.env.RAILWAY_PROVIDER_IDS;
    delete process.env.RAILWAY_PROVIDER_FIXTURE_A_KEY;
    delete process.env.RAILWAY_PROVIDER_FIXTURE_B_KEY;
  });

  it("with zero configured providers every capability yields NOT_CONFIGURED (requirement 5)", async () => {
    const env = await executeCapability(
      "trainSearch",
      async () => {
        throw new Error("provider must never be invoked when none is configured");
      },
      "req",
    );
    expect(env.data).toBeNull();
    expect(env.errors[0]?.code).toBe("NOT_CONFIGURED");
    expect(capabilityStatus()).toHaveLength(8);
    expect(capabilityStatus().every((c) => !c.configured)).toBe(true);
  });

  it("rejects adapters without a termsRef — compliance gate (requirement 10)", () => {
    const rogue = { ...makeSearchAdapter("rogue", []), termsRef: "" };
    expect(() => registerAdapter(rogue)).toThrow(/termsRef/);
  });

  it("activates an adapter only when id is listed AND credential is present", async () => {
    registerAdapter(makeSearchAdapter("fixture-a", [summaryOf("12951", "16:55")]));
    process.env.RAILWAY_PROVIDER_IDS = "fixture-a";

    // Registered + listed, but no credential yet → still not resolved.
    expect(resolveProviders("trainSearch")).toHaveLength(0);

    process.env.RAILWAY_PROVIDER_FIXTURE_A_KEY = "test-credential";
    expect(resolveProviders("trainSearch")).toHaveLength(1);

    const env = await executeCapability<TrainSummary[]>(
      "trainSearch",
      (p) => (p as TrainSearchProvider).search({ text: "x" }, { locale: "en", requestId: "req" }),
      "req",
    );
    expect(env.data).toHaveLength(1);
    expect(env.source.providerId).toBe("fixture-a");
  });

  it("an adapter not listed in RAILWAY_PROVIDER_IDS stays inactive", async () => {
    registerAdapter(makeSearchAdapter("fixture-a", [summaryOf("12951", "16:55")]));
    process.env.RAILWAY_PROVIDER_IDS = "someone-else";
    process.env.RAILWAY_PROVIDER_FIXTURE_A_KEY = "test-credential";
    const env = await executeCapability(
      "trainSearch",
      async () => {
        throw new Error("must not run");
      },
      "req",
    );
    expect(env.errors[0]?.code).toBe("NOT_CONFIGURED");
  });

  it("reconciles two disagreeing providers into contradictions", async () => {
    registerAdapter(makeSearchAdapter("fixture-a", [summaryOf("12951", "16:55")]));
    registerAdapter(makeSearchAdapter("fixture-b", [summaryOf("12951", "17:10")]));
    process.env.RAILWAY_PROVIDER_IDS = "fixture-a,fixture-b";
    process.env.RAILWAY_PROVIDER_FIXTURE_A_KEY = "cred-a";
    process.env.RAILWAY_PROVIDER_FIXTURE_B_KEY = "cred-b";

    const env = await executeCapability<TrainSummary[]>(
      "trainSearch",
      (p) => (p as TrainSearchProvider).search({ text: "x" }, { locale: "en", requestId: "req" }),
      "req",
    );
    expect(env.confidence).toBe("low");
    expect(env.contradictions?.length).toBeGreaterThan(0);
    const providers = env.contradictions?.[0]?.values.map((v) => v.providerId) ?? [];
    expect(providers).toContain("fixture-a");
    expect(providers).toContain("fixture-b");
  });
});
