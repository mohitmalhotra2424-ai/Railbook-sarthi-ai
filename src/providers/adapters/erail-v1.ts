/**
 * eRail adapter — FALLBACK train-search source (owner-authorized 2026-10-10,
 * see docs/provider-terms.md#erail-v1). Used only when the primary
 * (confirmtkt-v1) fails — see executeCapabilityFailover in src/providers/registry.ts.
 *
 * Capabilities: trainSearch ONLY. eRail's public data endpoint has no
 * seat-availability or fare data, so those capabilities stay with the primary.
 *
 * Access notes (recorded honestly):
 *  - https://erail.in/rail/getTrains.aspx is eRail's own site data endpoint
 *    (tab-separated text), undocumented and uncontracted. It throttles
 *    aggressively (returns "~~~~~Please try again after some time."); that is
 *    mapped to a retryable RATE_LIMITED error, never to fabricated data.
 *  - No login, no CAPTCHA bypass. Long cache TTL out of politeness.
 *  - The endpoint is not date-aware: it returns every train on the route with
 *    its running days. It needs IRCTC station CODES (it has no name lookup);
 *    when only names are available and the primary is down, we return an
 *    honest VALIDATION_FAILED instead of guessing a code.
 */

import { providerError, type ProviderError } from "@/domain/errors";
import { TrainSummarySchema, type TrainSummary } from "@/domain/schemas";
import { logger } from "@/lib/logger";
import { errorEnvelope, okEnvelope } from "@/providers/envelope";
import type {
  QueryContext,
  ResultEnvelope,
  SourceInfo,
  TrainSearchProvider,
  TrainSearchQuery,
} from "@/providers/types";

const TBS_URL = "https://erail.in/rail/getTrains.aspx";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SOURCE: SourceInfo = {
  providerId: "erail-v1",
  kind: "authorized-partner",
  termsRef: "docs/provider-terms.md#erail-v1",
  authorization: "configured",
};

const TBS_TTL_SECONDS = 3600;
const FETCH_TIMEOUT_MS = 15_000;

interface CacheEntry {
  expiresAt: number;
  value: TrainSummary[];
}
const cache = new Map<string, CacheEntry>();

/** Test hook — clears every cached upstream response. */
export function __clearErailCaches(): void {
  cache.clear();
}

function err<T>(requestId: string, error: ProviderError): ResultEnvelope<T> {
  return { ...errorEnvelope({ source: SOURCE, errors: [error], requestId }), data: null };
}

/** Parse eRail's tab-separated response. Exported for unit tests. */
export function parseErailTbs(body: string): { trains: TrainSummary[]; throttled: boolean } {
  if (/^~~~~~/.test(body.trimStart()) || body.includes("Please try again after some time")) {
    return { trains: [], throttled: true };
  }
  const trains: TrainSummary[] = [];
  let dropped = 0;
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("~~~~~")) continue;
    const f = line.split("\t");
    if (f.length < 10 || !/^\d{4,6}$/.test(f[0].trim())) {
      dropped += 1;
      continue;
    }
    const candidate = {
      trainNumber: f[0].trim(),
      trainName: f[1].trim(),
      from: { code: f[3].trim().toUpperCase(), name: f[2].trim() },
      to: { code: f[6].trim().toUpperCase(), name: f[5].trim() },
      departure: f[4].trim(),
      arrival: f[7].trim(),
      classes: f[10]
        ? f[10]
            .split(/[,\s]+/)
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean)
        : undefined,
    };
    const parsed = TrainSummarySchema.safeParse(candidate);
    if (parsed.success) trains.push(parsed.data);
    else dropped += 1;
  }
  if (dropped > 0) {
    logger.warn("erail: dropped unparseable TBS rows", { count: dropped, requestId: "adapter" });
  }
  return { trains, throttled: false };
}

async function searchTrains(q: TrainSearchQuery, ctx: QueryContext): Promise<ResultEnvelope<TrainSummary[]>> {
  if (!q.from || !q.to) {
    return err(
      ctx.requestId,
      providerError(
        "VALIDATION_FAILED",
        "The fallback provider needs explicit origin and destination stations.",
        { retryable: false },
      ),
    );
  }
  // eRail has no station-name lookup; only ALL-UPPERCASE IRCTC codes are used
  // honestly ("Delhi" is 5 letters but not a code; "Ludhiana" is not a code).
  const from = q.from.trim();
  const to = q.to.trim();
  if (!/^[A-Z]{2,5}$/.test(from) || !/^[A-Z]{2,5}$/.test(to)) {
    return err(
      ctx.requestId,
      providerError(
        "VALIDATION_FAILED",
        `Fallback source needs ALL-CAPS IRCTC station codes (got "${q.from}" / "${q.to}"); it has no name lookup.`,
        { retryable: false },
      ),
    );
  }

  const cacheKey = `${from}|${to}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return okEnvelope({ data: hit.value, source: SOURCE, ttlSeconds: TBS_TTL_SECONDS, requestId: ctx.requestId });
  }

  const url = `${TBS_URL}?StationFrom=${encodeURIComponent(from)}&StationTo=${encodeURIComponent(to)}&DataSource=0&Language=0&Cache=true`;
  let body: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/plain,*/*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 429) {
      return err(ctx.requestId, providerError("RATE_LIMITED", "eRail rate-limited the request (HTTP 429)."));
    }
    if (!res.ok) {
      return err(ctx.requestId, providerError("UPSTREAM_ERROR", `eRail returned HTTP ${res.status}.`));
    }
    body = await res.text();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err(ctx.requestId, providerError("UPSTREAM_ERROR", `eRail request failed: ${message}`));
  }

  const { trains, throttled } = parseErailTbs(body);
  if (throttled) {
    return err(
      ctx.requestId,
      providerError("RATE_LIMITED", "eRail is throttling requests right now; retry later.", { retryable: true }),
    );
  }
  if (trains.length === 0) {
    return err(
      ctx.requestId,
      providerError("UPSTREAM_ERROR", "eRail returned no parsable train rows for this route.", {
        retryable: true,
      }),
    );
  }
  if (cache.size > 100) cache.clear();
  cache.set(cacheKey, { expiresAt: Date.now() + TBS_TTL_SECONDS * 1000, value: trains });
  return okEnvelope({ data: trains, source: SOURCE, ttlSeconds: TBS_TTL_SECONDS, requestId: ctx.requestId });
}

export const erailAdapter: TrainSearchProvider = {
  id: "erail-v1",
  capabilities: ["trainSearch"],
  termsRef: "docs/provider-terms.md#erail-v1",
  /** Keyless public endpoint — activation is by RAILWAY_PROVIDER_IDS only. */
  credentialRequired: false,
  priority: 200,
  async health() {
    const started = Date.now();
    try {
      const res = await fetch(
        `${TBS_URL}?StationFrom=NDLS&StationTo=CNB&DataSource=0&Language=0&Cache=true`,
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      const body = await res.text();
      const { throttled } = parseErailTbs(body);
      return { ok: res.ok && !throttled, latencyMs: Date.now() - started, errors: [] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        latencyMs: Date.now() - started,
        errors: [providerError("UPSTREAM_ERROR", `eRail health check failed: ${message}`, { retryable: true })],
      };
    }
  },
  search: searchTrains,
};
