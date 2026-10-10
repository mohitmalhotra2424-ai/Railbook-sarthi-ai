/**
 * Provider configuration (server-only).
 *
 * This module exposes METADATA ONLY — ids and booleans. Credential values
 * are checked for presence but never returned, logged or serialized.
 */

const IDS_ENV = "RAILWAY_PROVIDER_IDS";

export function configuredProviderIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env[IDS_ENV] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Convention: adapter id "acme-rail-v1" → RAILWAY_PROVIDER_ACME_RAIL_V1_KEY */
export function providerKeyEnvName(id: string): string {
  return `RAILWAY_PROVIDER_${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_KEY`;
}

export function isProviderCredentialPresent(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[providerKeyEnvName(id)];
  return typeof value === "string" && value.trim().length > 0;
}

/** For /api/health — contains no secret values, only presence flags. */
export function describeProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): { id: string; credentialPresent: boolean }[] {
  return configuredProviderIds(env).map((id) => ({
    id,
    credentialPresent: isProviderCredentialPresent(id, env),
  }));
}

/** Requirement 9: booking stays disabled until explicitly enabled. */
export function bookingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BOOKING_ENABLED === "true";
}
