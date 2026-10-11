import { providerError, type ProviderError } from "@/domain/errors";
import { freshnessFor } from "@/lib/time";
import type { Capability, Freshness, ResultEnvelope, SourceInfo } from "./types";

export const NOT_CONFIGURED_SOURCE: SourceInfo = {
  providerId: "none",
  kind: "none",
  termsRef: "",
  authorization: "not-configured",
};

/**
 * The canonical answer when no authorized provider serves a capability
 * (requirement 5). The UI maps this to “Live data provider not configured.”
 */
export function notConfiguredEnvelope(
  capability: Capability,
  requestId: string,
  now: Date = new Date(),
): ResultEnvelope<null> {
  return {
    data: null,
    source: NOT_CONFIGURED_SOURCE,
    retrievedAt: now.toISOString(),
    freshness: "unknown",
    providerTimestamp: null,
    ttlSeconds: 0,
    errors: [
      providerError(
        "NOT_CONFIGURED",
        `Live data provider not configured for capability "${capability}".`,
      ),
    ],
    confidence: "low",
    requestId,
  };
}

export function okEnvelope<T>(params: {
  data: T;
  source: SourceInfo;
  ttlSeconds: number;
  requestId: string;
  retrievedAt?: Date;
  /** Documented upstream timestamp, when the provider truly supplies one. */
  providerTimestamp?: string | null;
}): ResultEnvelope<T> {
  const retrievedAt = (params.retrievedAt ?? new Date()).toISOString();
  const freshness: Freshness = freshnessFor(retrievedAt, params.ttlSeconds);
  return {
    data: params.data,
    source: params.source,
    retrievedAt,
    providerTimestamp: params.providerTimestamp ?? null,
    freshness,
    ttlSeconds: params.ttlSeconds,
    errors: [],
    confidence: "high",
    requestId: params.requestId,
  };
}

export function errorEnvelope(params: {
  source: SourceInfo;
  errors: ProviderError[];
  requestId: string;
  retrievedAt?: Date;
}): ResultEnvelope<null> {
  return {
    data: null,
    source: params.source,
    retrievedAt: (params.retrievedAt ?? new Date()).toISOString(),
    freshness: "unknown",
    providerTimestamp: null,
    ttlSeconds: 0,
    errors: params.errors,
    confidence: "low",
    requestId: params.requestId,
  };
}

export function isNotConfigured(env: ResultEnvelope<unknown>): boolean {
  return env.errors.some((e) => e.code === "NOT_CONFIGURED");
}

/** Structural shape check used at boundaries and by the contract suite. */
export function validateEnvelopeShape(value: unknown): value is ResultEnvelope<unknown> {
  if (typeof value !== "object" || value === null) return false;
  const env = value as Record<string, unknown>;
  if (!("data" in env)) return false; // data:null is valid; a missing field is not
  if (typeof env.source !== "object" || env.source === null) return false;
  if (typeof env.retrievedAt !== "string" || Number.isNaN(Date.parse(env.retrievedAt))) {
    return false;
  }
  const pts = (env as Record<string, unknown>).providerTimestamp;
  if (pts !== undefined && pts !== null && typeof pts !== "string") {
    return false;
  }
  if (env.freshness !== "fresh" && env.freshness !== "stale" && env.freshness !== "unknown") {
    return false;
  }
  if (typeof env.ttlSeconds !== "number") return false;
  if (!Array.isArray(env.errors)) return false;
  if (env.confidence !== "high" && env.confidence !== "medium" && env.confidence !== "low") {
    return false;
  }
  return typeof env.requestId === "string" && env.requestId.length > 0;
}
