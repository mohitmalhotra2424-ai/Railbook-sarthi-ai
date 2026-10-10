import { freshnessFor } from "@/lib/time";
import { validateEnvelopeShape } from "@/providers/envelope";
import type { ResultEnvelope } from "@/providers/types";

/**
 * The contract EVERY railway adapter output must satisfy (PLAN.md §4.3):
 *
 *   1. The value is a structurally valid ResultEnvelope.
 *   2. `freshness` is derived from retrievedAt + ttlSeconds — never hardcoded.
 *   3. Configured sources carry a non-empty termsRef (compliance gate).
 *   4. Error messages never contain credentials.
 *
 * Returns a list of violations — an empty list means compliant. Adapter test
 * suites run their outputs through this; deliberately-broken fixtures prove
 * each check actually fails when violated.
 */
export function envelopeContractViolations(
  value: unknown,
  opts: { secrets?: string[]; now?: Date } = {},
): string[] {
  const violations: string[] = [];
  const secrets = opts.secrets ?? [];
  const now = opts.now ?? new Date();

  if (!validateEnvelopeShape(value)) {
    return ["envelope shape invalid (missing/invalid required fields)"];
  }
  const env = value as ResultEnvelope<unknown>;

  if (env.data === undefined) {
    violations.push("data must be null or valid data, never undefined");
  }

  const expectedFreshness = freshnessFor(env.retrievedAt, env.ttlSeconds, now);
  if (env.freshness !== expectedFreshness) {
    violations.push(
      `freshness "${env.freshness}" is not derived from retrievedAt+ttl (expected "${expectedFreshness}")`,
    );
  }

  if (env.source.authorization === "configured" && !env.source.termsRef.trim()) {
    violations.push("configured source must carry a non-empty termsRef");
  }

  for (const error of env.errors) {
    for (const secret of secrets) {
      if (secret && error.message.includes(secret)) {
        violations.push("error message leaks a credential");
      }
    }
  }

  return violations;
}
