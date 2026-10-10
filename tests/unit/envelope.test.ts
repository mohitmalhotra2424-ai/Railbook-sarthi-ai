import { describe, expect, it } from "vitest";
import { providerError } from "@/domain/errors";
import {
  errorEnvelope,
  notConfiguredEnvelope,
  okEnvelope,
  validateEnvelopeShape,
} from "@/providers/envelope";
import type { SourceInfo } from "@/providers/types";

const source: SourceInfo = {
  providerId: "test-a",
  kind: "official-api",
  termsRef: "docs/provider-terms.md#test-a",
  authorization: "configured",
};

describe("notConfiguredEnvelope", () => {
  it("carries data:null, a NOT_CONFIGURED error and unknown freshness", () => {
    const env = notConfiguredEnvelope("pnr", "req-1");
    expect(env.data).toBeNull();
    expect(env.errors.map((e) => e.code)).toEqual(["NOT_CONFIGURED"]);
    expect(env.errors[0].message).toContain("Live data provider not configured");
    expect(env.freshness).toBe("unknown");
    expect(env.source.authorization).toBe("not-configured");
    expect(env.requestId).toBe("req-1");
    expect(validateEnvelopeShape(env)).toBe(true);
  });
});

describe("okEnvelope", () => {
  it("computes freshness from retrievedAt + ttl (fresh)", () => {
    const env = okEnvelope({
      data: { ok: true },
      source,
      ttlSeconds: 300,
      requestId: "r",
    });
    expect(env.freshness).toBe("fresh");
    expect(env.confidence).toBe("high");
    expect(env.errors).toEqual([]);
  });

  it("computes stale when retrievedAt is older than the ttl", () => {
    const env = okEnvelope({
      data: 1,
      source,
      ttlSeconds: 60,
      requestId: "r",
      retrievedAt: new Date(Date.now() - 120_000),
    });
    expect(env.freshness).toBe("stale");
  });
});

describe("errorEnvelope", () => {
  it("keeps data null and preserves errors", () => {
    const env = errorEnvelope({
      source,
      errors: [providerError("RATE_LIMITED", "slow down", { retryable: true })],
      requestId: "r",
    });
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("RATE_LIMITED");
    expect(validateEnvelopeShape(env)).toBe(true);
  });
});

describe("validateEnvelopeShape", () => {
  it("rejects envelopes with missing or invalid required fields", () => {
    const env = notConfiguredEnvelope("pnr", "req-1");
    expect(validateEnvelopeShape({ ...env, retrievedAt: "yesterday" })).toBe(false);
    expect(validateEnvelopeShape({ ...env, freshness: "maybe" })).toBe(false);
    expect(validateEnvelopeShape({ ...env, requestId: "" })).toBe(false);

    const broken = { ...env } as Record<string, unknown>;
    delete broken.data;
    expect(validateEnvelopeShape(broken)).toBe(false);
    expect(validateEnvelopeShape(null)).toBe(false);
    expect(validateEnvelopeShape("envelope")).toBe(false);
  });
});
