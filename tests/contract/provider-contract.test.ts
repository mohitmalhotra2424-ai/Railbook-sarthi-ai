import { describe, expect, it } from "vitest";
import { providerError } from "@/domain/errors";
import { errorEnvelope, okEnvelope } from "@/providers/envelope";
import type { ResultEnvelope, SourceInfo } from "@/providers/types";
import { envelopeContractViolations } from "./contract-suite";

const source: SourceInfo = {
  providerId: "fixture",
  kind: "official-api",
  termsRef: "docs/provider-terms.md#fixture",
  authorization: "configured",
};
const SECRET = "adapter-secret-value-999";

describe("provider contract — compliant fixtures pass", () => {
  it("accepts envelopes built by okEnvelope", () => {
    const env = okEnvelope({ data: { ok: 1 }, source, ttlSeconds: 600, requestId: "r" });
    expect(envelopeContractViolations(env)).toEqual([]);
  });

  it("accepts error envelopes", () => {
    const env = errorEnvelope({
      source,
      errors: [providerError("UPSTREAM_ERROR", "upstream said no")],
      requestId: "r",
    });
    expect(envelopeContractViolations(env)).toEqual([]);
  });
});

describe("provider contract — every violation is caught", () => {
  it("rejects hardcoded freshness", () => {
    const env = okEnvelope({
      data: 1,
      source,
      ttlSeconds: 1,
      requestId: "r",
      retrievedAt: new Date(Date.now() - 60_000),
    });
    const forged: ResultEnvelope<number> = { ...env, freshness: "fresh" };
    expect(envelopeContractViolations(forged).join("; ")).toContain("freshness");
  });

  it("rejects missing retrievedAt", () => {
    const broken = { ...okEnvelope({ data: 1, source, ttlSeconds: 600, requestId: "r" }) } as Record<
      string,
      unknown
    >;
    delete broken.retrievedAt;
    expect(envelopeContractViolations(broken).length).toBeGreaterThan(0);
  });

  it("rejects credentials leaked in error messages", () => {
    const env = errorEnvelope({
      source,
      errors: [providerError("UPSTREAM_ERROR", `auth failed with key ${SECRET}`)],
      requestId: "r",
    });
    expect(envelopeContractViolations(env, { secrets: [SECRET] }).join("; ")).toContain(
      "credential",
    );
  });

  it("rejects configured sources without a termsRef", () => {
    const rogue: SourceInfo = { ...source, termsRef: "" };
    const env = okEnvelope({ data: 1, source: rogue, ttlSeconds: 600, requestId: "r" });
    expect(envelopeContractViolations(env).join("; ")).toContain("termsRef");
  });

  it("rejects non-envelope values outright", () => {
    expect(envelopeContractViolations({ data: null }).length).toBeGreaterThan(0);
    expect(envelopeContractViolations(undefined).length).toBeGreaterThan(0);
  });
});
