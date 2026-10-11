import { providerError } from "@/domain/errors";
import { NOT_CONFIGURED_SOURCE } from "./envelope";
import type { Capability, Contradiction, ResultEnvelope } from "./types";

/**
 * Multi-source reconciliation (requirement 7).
 *
 * - Agreeing sources  → confidence "high".
 * - Conflicting sources → BOTH values are retained in `contradictions`,
 *   confidence drops to "low". Nothing is averaged, merged or silently
 *   “resolved”. The UI renders an explicit uncertainty notice.
 */

type FieldExtractor = (data: unknown) => Record<string, unknown>;

function byKey<T>(
  rows: T[],
  key: (row: T) => string,
  value: (row: T) => unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of rows) out[key(row)] = value(row);
  return out;
}

const FIELD_EXTRACTORS: Record<Capability, FieldExtractor> = {
  trainSearch: (data) =>
    byKey(
      data as { trainNumber: string; departure: string; arrival: string }[],
      (r) => r.trainNumber,
      (r) => `${r.departure}|${r.arrival}`,
    ),
  trainDetails: (data) => {
    const d = data as { trainNumber: string; trainName: string };
    return { trainNumber: d.trainNumber, trainName: d.trainName };
  },
  timetable: (data) =>
    byKey(
      (data as { entries: { station: { code: string }; arrival: string | null; departure: string | null }[] }).entries,
      (e) => e.station.code,
      (e) => `${e.arrival}|${e.departure}`,
    ),
  liveStatus: (data) => {
    const d = data as { running: boolean | null; lastStation: { code: string } | null; delayMinutes: number | null };
    return {
      running: d.running,
      lastStation: d.lastStation?.code ?? null,
      delayMinutes: d.delayMinutes,
    };
  },
  seatAvailability: (data) =>
    byKey(
      (data as { classes: { classCode: string; status: string }[] }).classes,
      (c) => c.classCode,
      (c) => c.status,
    ),
  fare: (data) => {
    const d = data as { baseFare: number; totalFare: number };
    return { baseFare: d.baseFare, totalFare: d.totalFare };
  },
  pnr: (data) => {
    const d = data as { trainNumber: string | null; chartPrepared: boolean; passengers: { passengerNumber: number; currentStatus: string }[] };
    return {
      trainNumber: d.trainNumber,
      chartPrepared: d.chartPrepared,
      ...byKey(
        d.passengers,
        (p) => `passenger${p.passengerNumber}`,
        (p) => p.currentStatus,
      ),
    };
  },
  cancellations: (data) =>
    byKey(
      data as { trainNumber: string; kind: string }[],
      (r) => r.trainNumber,
      (r) => r.kind,
    ),
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function canonicalEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

export function collectContradictions(
  capability: Capability,
  envelopes: ResultEnvelope<unknown>[],
): Contradiction[] {
  const usable = envelopes.filter((e) => e.data !== null && e.data !== undefined);
  if (usable.length < 2) return [];
  const extract = FIELD_EXTRACTORS[capability];
  const primaryFields = extract(usable[0].data);
  const contradictions: Contradiction[] = [];

  for (const [field, primaryValue] of Object.entries(primaryFields)) {
    const values: { providerId: string; value: unknown }[] = [
      { providerId: usable[0].source.providerId, value: primaryValue },
    ];
    for (const env of usable.slice(1)) {
      const otherValue = extract(env.data)[field];
      if (!canonicalEqual(primaryValue, otherValue)) {
        values.push({ providerId: env.source.providerId, value: otherValue });
      }
    }
    // Deduplicate identical (provider, value) pairs before declaring conflict.
    const seen = new Set<string>();
    const distinct = values.filter((v) => {
      const sig = `${v.providerId}:${stableStringify(v.value)}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
    const conflicting = new Set(distinct.map((v) => stableStringify(v.value)));
    if (conflicting.size > 1) contradictions.push({ field, values: distinct });
  }
  return contradictions;
}

export function reconcileEnvelopes<T>(
  capability: Capability,
  envelopes: ResultEnvelope<T | null>[],
  requestId: string,
  now: Date = new Date(),
): ResultEnvelope<T | null> {
  if (envelopes.length === 0) {
    return {
      data: null,
      source: NOT_CONFIGURED_SOURCE,
      retrievedAt: now.toISOString(),
      providerTimestamp: null,
      freshness: "unknown",
      ttlSeconds: 0,
      errors: [providerError("UPSTREAM_ERROR", "No provider was invoked.", { retryable: true })],
      confidence: "low",
      requestId,
    };
  }

  const usable = envelopes.filter((e) => e.data !== null && e.data !== undefined);
  const allErrors = envelopes.flatMap((e) => e.errors);

  if (usable.length === 0) {
    return {
      data: null,
      source: envelopes[0].source,
      retrievedAt: now.toISOString(),
      providerTimestamp: envelopes[0].providerTimestamp ?? null,
      freshness: "unknown",
      ttlSeconds: 0,
      errors: allErrors.length
        ? allErrors
        : [providerError("UPSTREAM_ERROR", "All configured providers failed.", { retryable: true })],
      confidence: "low",
      requestId,
    };
  }

  if (usable.length === 1) {
    const env = usable[0];
    return { ...env, errors: allErrors, requestId };
  }

  const [primary] = usable;
  const contradictions = collectContradictions(
    capability,
    usable as ResultEnvelope<unknown>[],
  );
  return {
    data: primary.data,
    source: primary.source,
    retrievedAt: primary.retrievedAt,
    providerTimestamp: primary.providerTimestamp ?? null,
    freshness: primary.freshness,
    ttlSeconds: primary.ttlSeconds,
    errors: allErrors,
    confidence: contradictions.length === 0 ? "high" : "low",
    ...(contradictions.length ? { contradictions } : {}),
    requestId,
  };
}
