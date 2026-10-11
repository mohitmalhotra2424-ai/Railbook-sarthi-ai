import { describe, expect, it } from "vitest";
import { providerError } from "@/domain/errors";
import { okEnvelope } from "@/providers/envelope";
import { reconcileEnvelopes } from "@/providers/reconcile";
import type { ResultEnvelope, SourceInfo } from "@/providers/types";

const sourceA: SourceInfo = {
  providerId: "prov-a",
  kind: "official-api",
  termsRef: "docs/provider-terms.md#prov-a",
  authorization: "configured",
};
const sourceB: SourceInfo = {
  providerId: "prov-b",
  kind: "authorized-partner",
  termsRef: "docs/provider-terms.md#prov-b",
  authorization: "configured",
};

function fare(base: number, total: number) {
  return {
    trainNumber: "12951",
    classCode: "3A",
    from: { code: "NDLS", name: "New Delhi" },
    to: { code: "BCT", name: "Mumbai Central" },
    baseFare: base,
    totalFare: total,
    currency: "INR",
  };
}

describe("reconcileEnvelopes (requirement 7)", () => {
  it("agreement between sources keeps high confidence", () => {
    const a = okEnvelope({ data: fare(1000, 1100), source: sourceA, ttlSeconds: 600, requestId: "r" });
    const b = okEnvelope({ data: fare(1000, 1100), source: sourceB, ttlSeconds: 600, requestId: "r" });
    const merged = reconcileEnvelopes("fare", [a, b], "r");
    expect(merged.confidence).toBe("high");
    expect(merged.contradictions).toBeUndefined();
  });

  it("disagreement retains BOTH values and lowers confidence — nothing averaged", () => {
    const a = okEnvelope({ data: fare(1000, 1100), source: sourceA, ttlSeconds: 600, requestId: "r" });
    const b = okEnvelope({ data: fare(1000, 1250), source: sourceB, ttlSeconds: 600, requestId: "r" });
    const merged = reconcileEnvelopes("fare", [a, b], "r");

    expect(merged.confidence).toBe("low");
    const c = merged.contradictions?.find((x) => x.field === "totalFare");
    expect(c).toBeDefined();
    const values = c!.values.map((v) => [v.providerId, v.value]);
    expect(values).toContainEqual(["prov-a", 1100]);
    expect(values).toContainEqual(["prov-b", 1250]);
    // The displayed data is the primary source value, never a computed middle.
    expect(merged.data!.totalFare).toBe(1100);
  });

  it("detects PNR passenger status conflicts per passenger", () => {
    const pnr = (status: string) => ({
      pnr: "1234567890",
      trainNumber: "12951",
      trainName: "Mumbai Rajdhani",
      journeyDate: "2026-10-12",
      chartPrepared: true,
      passengers: [{ passengerNumber: 1, bookingStatus: "3A/CNF", currentStatus: status }],
    });
    const a = okEnvelope({ data: pnr("CNF/B2"), source: sourceA, ttlSeconds: 120, requestId: "r" });
    const b = okEnvelope({ data: pnr("RAC/12"), source: sourceB, ttlSeconds: 120, requestId: "r" });
    const merged = reconcileEnvelopes("pnr", [a, b], "r");
    expect(merged.contradictions?.map((c) => c.field)).toContain("passenger1");
  });

  it("keeps errors and null data when all providers fail", () => {
    const failed: ResultEnvelope<null> = {
      data: null,
      source: sourceA,
      retrievedAt: new Date().toISOString(),
      freshness: "unknown",
    providerTimestamp: null,
      ttlSeconds: 0,
      errors: [providerError("UPSTREAM_ERROR", "boom", { retryable: true })],
      confidence: "low",
      requestId: "r",
    };
    const merged = reconcileEnvelopes("pnr", [failed], "r");
    expect(merged.data).toBeNull();
    expect(merged.errors[0]?.code).toBe("UPSTREAM_ERROR");
  });

  it("zero envelopes yields an error envelope, never data", () => {
    const merged = reconcileEnvelopes("pnr", [], "r");
    expect(merged.data).toBeNull();
    expect(merged.errors.length).toBeGreaterThan(0);
  });
});
