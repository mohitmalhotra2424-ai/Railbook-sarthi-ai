import { providerError, type ProviderError } from "@/domain/errors";
import { confirmtktAdapter } from "./adapters/confirmtkt-v1";
import { erailAdapter } from "./adapters/erail-v1";
import { webDataAdapter } from "./adapters/web-data-v1";
import { railyatriSeatAdapter } from "./adapters/railyatri-seat-v1";
import { configuredProviderIds, isProviderCredentialPresent } from "./config";
import { notConfiguredEnvelope } from "./envelope";
import { reconcileEnvelopes } from "./reconcile";
import {
  ALL_CAPABILITIES,
  type Capability,
  type RailwayProvider,
  type ResultEnvelope,
} from "./types";

/**
 * Provider registry — capability → configured adapter(s), ordered.
 *
 * Phase 1 ships ZERO railway adapters: no authorized live provider exists yet
 * (requirement 5). Future adapters register via `registerAdapter` after
 * passing the terms checklist in src/providers/adapters/README.md.
 *
 * An adapter activates only when ALL of these hold:
 *   1. it is registered here,
 *   2. its id is listed in RAILWAY_PROVIDER_IDS,
 *   3. its credential env var is present,
 *   4. it carries a non-empty termsRef (enforced at registration).
 */

const adapters: RailwayProvider[] = [];

export function registerAdapter(adapter: RailwayProvider): void {
  if (!adapter.id.trim()) {
    throw new Error("Adapter registration rejected: empty id.");
  }
  if (!adapter.termsRef.trim()) {
    // Compliance gate (requirement 10): no terms record, no registration.
    throw new Error(
      `Adapter registration rejected: "${adapter.id}" has no termsRef. Record its access terms in docs/provider-terms.md first.`,
    );
  }
  if (adapters.some((a) => a.id === adapter.id)) {
    throw new Error(`Adapter registration rejected: duplicate id "${adapter.id}".`);
  }
  adapters.push(adapter);
}

/** Test/maintenance hook — production code should not need this. */
export function unregisterAdapter(id: string): void {
  const index = adapters.findIndex((a) => a.id === id);
  if (index >= 0) adapters.splice(index, 1);
}

export function registeredAdapters(): readonly RailwayProvider[] {
  return adapters;
}

export function resolveProviders(capability: Capability): RailwayProvider[] {
  const ids = new Set(configuredProviderIds());
  return adapters.filter(
    (a) =>
      a.capabilities.includes(capability) &&
      ids.has(a.id) &&
      (a.credentialRequired === false || isProviderCredentialPresent(a.id)),
  );
}

export function capabilityStatus(): {
  capability: Capability;
  providerIds: string[];
  configured: boolean;
}[] {
  return ALL_CAPABILITIES.map((capability) => {
    const providerIds = resolveProviders(capability).map((p) => p.id);
    return { capability, providerIds, configured: providerIds.length > 0 };
  });
}

/**
 * Run a capability across every configured provider and reconcile.
 * With zero configured providers this is the canonical NOT_CONFIGURED
 * envelope — there is no mock-data path anywhere in production code.
 */
export async function executeCapability<T>(
  capability: Capability,
  invoke: (provider: RailwayProvider) => Promise<ResultEnvelope<T | null>>,
  requestId: string,
): Promise<ResultEnvelope<T | null>> {
  const providers = resolveProviders(capability);
  if (providers.length === 0) return notConfiguredEnvelope(capability, requestId);

  const settled = await Promise.allSettled(providers.map((p) => invoke(p)));
  const envelopes: ResultEnvelope<T | null>[] = settled.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    const provider = providers[i];
    return {
      data: null,
      source: {
        providerId: provider.id,
        kind: "authorized-partner" as const,
        termsRef: provider.termsRef,
        authorization: "configured" as const,
      },
      retrievedAt: new Date().toISOString(),
      freshness: "unknown" as const,
      providerTimestamp: null,
      ttlSeconds: 0,
      errors: [
        providerError(
          "UPSTREAM_ERROR",
          result.reason instanceof Error
            ? `Provider "${provider.id}" failed: ${result.reason.message}`
            : `Provider "${provider.id}" failed.`,
          { retryable: true },
        ),
      ],
      confidence: "low" as const,
      requestId,
    };
  });

  return reconcileEnvelopes(capability, envelopes, requestId);
}

/**
 * Failover execution ("if not available, try the next source").
 *
 * Providers run in `priority` order (lower first). The first provider that
 * returns usable data wins; providers after it are NOT called — this keeps
 * traffic to unofficial endpoints minimal. Failures of earlier providers are
 * preserved in the winning envelope's `errors` for transparency, and when
 * every provider fails the honest merged error envelope is returned.
 * There is no mock or fabricated-data path.
 */
export async function executeCapabilityFailover<T>(
  capability: Capability,
  invoke: (provider: RailwayProvider) => Promise<ResultEnvelope<T | null>>,
  requestId: string,
): Promise<ResultEnvelope<T | null>> {
  const providers = [...resolveProviders(capability)].sort(
    (a, b) => (a.priority ?? 100) - (b.priority ?? 100),
  );
  if (providers.length === 0) return notConfiguredEnvelope(capability, requestId);

  const failures: ProviderError[] = [];
  let lastTried: { providerId: string; kind: "authorized-partner"; termsRef: string; authorization: "configured" } | null =
    null;
  for (const provider of providers) {
    let env: ResultEnvelope<T | null>;
    try {
      env = await invoke(provider);
    } catch (reason) {
      lastTried = {
        providerId: provider.id,
        kind: "authorized-partner",
        termsRef: provider.termsRef,
        authorization: "configured",
      };
      failures.push(
        providerError(
          "UPSTREAM_ERROR",
          reason instanceof Error
            ? `Provider "${provider.id}" failed: ${reason.message}`
            : `Provider "${provider.id}" failed.`,
          { retryable: true },
        ),
      );
      continue;
    }
    if (env.data !== null && env.data !== undefined) {
      return failures.length > 0 ? { ...env, errors: [...failures, ...env.errors] } : env;
    }
    lastTried = {
      providerId: env.source.providerId,
      kind: "authorized-partner",
      termsRef: env.source.termsRef,
      authorization: "configured",
    };
    failures.push(...env.errors);
    // Query-level refusals (invalid input, nothing found) are NOT provider
    // failures — another source cannot answer them either, and e.g. eRail's
    // date-unaware list would be misleading for a rejected date. Stop here.
    if (env.errors.length > 0 && env.errors.every((e) => e.retryable === false)) {
      break;
    }
  }

  // Every invoked provider failed — return the honest merged failure,
  // attributed to the provider that was actually tried last.
  const attributed =
    lastTried ?? {
      providerId: providers[providers.length - 1].id,
      kind: "authorized-partner" as const,
      termsRef: providers[providers.length - 1].termsRef,
      authorization: "configured" as const,
    };
  return {
    data: null,
    source: attributed,
    retrievedAt: new Date().toISOString(),
    freshness: "unknown",
    providerTimestamp: null,
    ttlSeconds: 0,
    errors: failures,
    confidence: "low",
    requestId,
  };
}

/* ---------------- built-in adapters (owner-authorized 2026-10-10) ---------------- */

registerAdapter(confirmtktAdapter); // primary: search + availability + fare
registerAdapter(erailAdapter); // fallback: search + fare
registerAdapter(webDataAdapter); // timetable + liveStatus (owner-supplied web chains)
registerAdapter(railyatriSeatAdapter); // availability fallback — inactive until owner supplies RailYatri user id
