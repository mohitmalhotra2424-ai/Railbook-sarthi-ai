import type { Freshness } from "@/providers/types";

/**
 * Freshness is ALWAYS computed from the server-set retrieval timestamp and
 * the envelope TTL — it is never hardcoded by an adapter (contract-tested).
 */
export function freshnessFor(
  retrievedAt: string | Date,
  ttlSeconds: number,
  now: Date = new Date(),
): Freshness {
  const t = retrievedAt instanceof Date ? retrievedAt : new Date(retrievedAt);
  if (Number.isNaN(t.getTime())) return "unknown";
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return "unknown";
  const ageSeconds = (now.getTime() - t.getTime()) / 1000;
  if (ageSeconds < 0) return "unknown"; // clock skew — refuse to claim freshness
  return ageSeconds <= ttlSeconds ? "fresh" : "stale";
}

export function isoNow(now: Date = new Date()): string {
  return now.toISOString();
}
