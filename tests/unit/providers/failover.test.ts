import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmtktAdapter } from "@/providers/adapters/confirmtkt-v1";
import { erailAdapter } from "@/providers/adapters/erail-v1";
import { errorEnvelope, okEnvelope } from "@/providers/envelope";
import {
  executeCapabilityFailover,
  registerAdapter,
  resolveProviders,
  unregisterAdapter,
} from "@/providers/registry";
import { providerError } from "@/domain/errors";
import type { RailwayProvider, ResultEnvelope, SourceInfo, TrainSummary } from "@/providers/types";

function source(id: string): SourceInfo {
  return { providerId: id, kind: "authorized-partner", termsRef: `docs/provider-terms.md#${id}`, authorization: "configured" };
}

function okData(id: string): TrainSummary[] {
  return [
    {
      trainNumber: "12951",
      trainName: `FROM-${id}`,
      from: { code: "LDH", name: "Ludhiana Jn" },
      to: { code: "NDLS", name: "New Delhi" },
      departure: "01:10",
      arrival: "04:55",
    },
  ];
}

function makeFake(
  id: string,
  priority: number,
  behavior: "ok" | "error" | "throw" | "nonretryable",
): RailwayProvider & { calls: number } {
  const fake = {
    id,
    capabilities: ["trainSearch"] as const,
    termsRef: `docs/provider-terms.md#${id}`,
    credentialRequired: false,
    priority,
    calls: 0,
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async search(): Promise<ResultEnvelope<TrainSummary[] | null>> {
      fake.calls += 1;
      if (behavior === "throw") throw new Error(`${id} exploded`);
      if (behavior === "nonretryable") {
        return errorEnvelope({
          source: source(id),
          errors: [providerError("VALIDATION_FAILED", `${id}: journey date cannot be in the past`, { retryable: false })],
          requestId: "r",
        });
      }
      if (behavior === "error") {
        return errorEnvelope({
          source: source(id),
          errors: [providerError("UPSTREAM_ERROR", `${id} is down`, { retryable: true })],
          requestId: "r",
        });
      }
      return okEnvelope({ data: okData(id), source: source(id), ttlSeconds: 60, requestId: "r" });
    },
  };
  return fake as unknown as RailwayProvider & { calls: number };
}

const fakes: string[] = [];
function addFake(id: string, priority: number, behavior: "ok" | "error" | "throw" | "nonretryable") {
  registerAdapter(makeFake(id, priority, behavior));
  fakes.push(id);
}

afterEach(() => {
  for (const id of fakes.splice(0)) unregisterAdapter(id);
  vi.unstubAllEnvs();
});

describe("credential-free activation (keyless public endpoints)", () => {
  it("confirmtkt-v1 resolves without any *_KEY env var", () => {
    vi.stubEnv("RAILWAY_PROVIDER_IDS", "confirmtkt-v1");
    const ids = resolveProviders("seatAvailability").map((p) => p.id);
    expect(ids).toContain("confirmtkt-v1");
    expect(confirmtktAdapter.credentialRequired).toBe(false);
  });

  it("erail-v1 stays a trainSearch-only fallback, ordered after the primary", () => {
    vi.stubEnv("RAILWAY_PROVIDER_IDS", "erail-v1");
    expect(resolveProviders("trainSearch").map((p) => p.id)).toContain("erail-v1");
    expect(resolveProviders("seatAvailability").map((p) => p.id)).not.toContain("erail-v1");
    expect(resolveProviders("fare").map((p) => p.id)).not.toContain("erail-v1");
    expect(erailAdapter.priority).toBeGreaterThan(confirmtktAdapter.priority ?? 100);
  });
});

describe("executeCapabilityFailover — 'if not available, try the next source'", () => {
  it("primary failure falls through to the fallback, keeping the failure visible", async () => {
    vi.stubEnv("RAILWAY_PROVIDER_IDS", "fo-bad,fo-good");
    addFake("fo-bad", 50, "error");
    addFake("fo-good", 100, "ok");
    const env = await executeCapabilityFailover<TrainSummary[]>(
      "trainSearch",
      (p) => (p as unknown as { search: () => Promise<ResultEnvelope<TrainSummary[] | null>> }).search(),
      "r",
    );
    expect(env.data?.[0].trainName).toBe("FROM-fo-good");
    expect(env.source.providerId).toBe("fo-good");
    expect(env.errors.map((e) => e.message)).toEqual(["fo-bad is down"]); // primary failure preserved
  });

  it("does NOT call the fallback when the primary succeeds (politeness)", async () => {
    vi.stubEnv("RAILWAY_PROVIDER_IDS", "fo-pri,fo-back");
    const pri = makeFake("fo-pri", 10, "ok");
    const back = makeFake("fo-back", 20, "ok");
    registerAdapter(pri);
    registerAdapter(back);
    fakes.push("fo-pri", "fo-back");
    const env = await executeCapabilityFailover<TrainSummary[]>(
      "trainSearch",
      (p) => (p as unknown as { search: () => Promise<ResultEnvelope<TrainSummary[] | null>> }).search(),
      "r",
    );
    expect(env.data?.[0].trainName).toBe("FROM-fo-pri");
    expect(pri.calls).toBe(1);
    expect(back.calls).toBe(0);
  });

  it("a throwing provider is contained; the next one still answers", async () => {
    vi.stubEnv("RAILWAY_PROVIDER_IDS", "fo-throw,fo-good2");
    addFake("fo-throw", 5, "throw");
    addFake("fo-good2", 50, "ok");
    const env = await executeCapabilityFailover<TrainSummary[]>(
      "trainSearch",
      (p) => (p as unknown as { search: () => Promise<ResultEnvelope<TrainSummary[] | null>> }).search(),
      "r",
    );
    expect(env.data?.[0].trainName).toBe("FROM-fo-good2");
    expect(env.errors[0].message).toContain("fo-throw exploded");
  });

  it("non-retryable query refusals do NOT trigger the fallback (no misleading data)", async () => {
    vi.stubEnv("RAILWAY_PROVIDER_IDS", "fo-refuse,fo-back2");
    const refuse = makeFake("fo-refuse", 10, "nonretryable");
    const back = makeFake("fo-back2", 20, "ok");
    registerAdapter(refuse);
    registerAdapter(back);
    fakes.push("fo-refuse", "fo-back2");
    const env = await executeCapabilityFailover<TrainSummary[]>(
      "trainSearch",
      (p) => (p as unknown as { search: () => Promise<ResultEnvelope<TrainSummary[] | null>> }).search(),
      "r",
    );
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("VALIDATION_FAILED");
    expect(env.source.providerId).toBe("fo-refuse"); // attributed to the provider actually tried
    expect(refuse.calls).toBe(1);
    expect(back.calls).toBe(0); // fallback never invoked for a query-level refusal
  });

  it("all providers failing → honest merged error, data null, low confidence", async () => {
    vi.stubEnv("RAILWAY_PROVIDER_IDS", "fo-x,fo-y");
    addFake("fo-x", 10, "error");
    addFake("fo-y", 20, "throw");
    const env = await executeCapabilityFailover<TrainSummary[]>(
      "trainSearch",
      (p) => (p as unknown as { search: () => Promise<ResultEnvelope<TrainSummary[] | null>> }).search(),
      "r",
    );
    expect(env.data).toBeNull();
    expect(env.confidence).toBe("low");
    expect(env.errors).toHaveLength(2);
    expect(env.source.providerId).toBe("fo-y"); // last provider actually invoked
  });

  it("no configured provider → canonical NOT_CONFIGURED (no mock path)", async () => {
    vi.stubEnv("RAILWAY_PROVIDER_IDS", "");
    const env = await executeCapabilityFailover<TrainSummary[]>("trainSearch", async () => {
      throw new Error("must not be invoked");
    }, "r");
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("NOT_CONFIGURED");
  });
});
