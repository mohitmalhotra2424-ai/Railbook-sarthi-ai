/**
 * eRail adapter — FALLBACK source (owner-authorized 2026-10-10,
 * see docs/provider-terms.md#erail-v1). Used only when the primary
 * (confirmtkt-v1) fails — see executeCapabilityFailover in src/providers/registry.ts.
 *
 * Capabilities: trainSearch + fare. Also exports the local station table
 * (erail.in/js/cmp/stations.js, ~9000 stations, 6 h cache) used for name→code
 * resolution and as the /api/railway/stations fallback.
 *
 * Access notes (recorded honestly):
 *  - Endpoints are eRail's own site data endpoints (SSR pages + a delimited
 *    text feed), undocumented and uncontracted. Throttling ("~~~~~Please try
 *    again after some time.") maps to a retryable RATE_LIMITED error — never
 *    to fabricated data.
 *  - No login, no CAPTCHA bypass. Long cache TTLs out of politeness.
 *  - TBS feed is not date-aware (running-days string only).
 *  - Fare pages silently fall back to the train's full route when the
 *    requested from/to are not on the route — we VERIFY the page's own
 *    `selected` options and refuse to return a fare for a different pair
 *    (owner's explicit rule, 2026-10-10).
 */

import { providerError, type ProviderError } from "@/domain/errors";
import { FareSchema, TrainSummarySchema, type Fare, type TrainSummary } from "@/domain/schemas";
import { logger } from "@/lib/logger";
import { errorEnvelope, okEnvelope } from "@/providers/envelope";
import type {
  FareProvider,
  FareQuery,
  QueryContext,
  ResultEnvelope,
  SourceInfo,
  TrainSearchProvider,
  TrainSearchQuery,
} from "@/providers/types";

const TBS_URL = "https://erail.in/rail/getTrains.aspx";
const FARE_URL = "https://erail.in/train-fare";
const STATIONS_URL = "https://erail.in/js/cmp/stations.js";

const SOURCE: SourceInfo = {
  providerId: "erail-v1",
  kind: "authorized-partner",
  termsRef: "docs/provider-terms.md#erail-v1",
  authorization: "configured",
};

const TBS_TTL_SECONDS = 3600;
const FARE_TTL_SECONDS = 21_600; // 6 h — fares are schedule-based, not live
const STATIONS_TTL_MS = 6 * 3600_000;
const FETCH_TIMEOUT_MS = 15_000;

/* ---------------- caches ---------------- */

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}
const cache = new Map<string, CacheEntry>();

/** Test hook — clears every cached upstream response. */
export function __clearErailCaches(): void {
  cache.clear();
}

let minStations = 1000;
/** Test hook — the production guard refuses partial tables (<1000 stations). */
export function __setMinStationsForTest(n: number): void {
  minStations = n;
}

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown, ttlMs: number): void {
  if (cache.size > 300) cache.clear();
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

function err<T>(requestId: string, error: ProviderError): ResultEnvelope<T> {
  return { ...errorEnvelope({ source: SOURCE, errors: [error], requestId }), data: null };
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(url, {
    headers: {
      // Owner's browser-header recipe (2026-10-10) — reduces SSR blocking.
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*",
      "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      Referer: "https://erail.in/",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

/* ---------------- station table (stations.js) ---------------- */

export interface ErailStation {
  code: string;
  name: string;
}

/** Parse `var StationsData="CODE,Name,CODE,Name,...";` — exported for tests. */
export function parseStationsJs(body: string): ErailStation[] {
  const m = /StationsData\s*=\s*"([^"]*)"/.exec(body);
  if (!m) return [];
  const parts = m[1].split(",");
  const out: ErailStation[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const code = parts[i].trim().toUpperCase();
    const name = parts[i + 1].trim();
    if (/^[A-Z]{2,5}$/.test(code) && name) out.push({ code, name });
  }
  return out;
}

async function stationTable(): Promise<ErailStation[]> {
  const cached = cacheGet<ErailStation[]>("stations");
  if (cached) return cached;
  const { ok, body } = await fetchText(STATIONS_URL);
  if (!ok) throw new Error(`eRail stations.js returned HTTP ${ok}`);
  const stations = parseStationsJs(body);
  if (stations.length < minStations) {
    throw new Error(`eRail stations.js parsed to only ${stations.length} stations — refusing partial table`);
  }
  cacheSet("stations", stations, STATIONS_TTL_MS);
  return stations;
}

/** Name/code → station, deterministic: exact name > unique prefix > error. */
export async function resolveErailStation(input: string): Promise<ErailStation | null> {
  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();
  let table: ErailStation[];
  try {
    table = await stationTable();
  } catch (cause) {
    // Table unavailable: accept ALL-CAPS codes as-is (cannot verify names).
    if (/^[A-Z]{2,5}$/.test(trimmed)) return { code: trimmed, name: trimmed };
    logger.warn("erail: station table unavailable", {
      error: cause instanceof Error ? cause.message : String(cause),
      requestId: "adapter",
    });
    return null;
  }
  const byCode = table.find((s) => s.code === upper);
  if (byCode) return byCode;
  const lower = trimmed.toLowerCase();
  const exact = table.find((s) => s.name.toLowerCase() === lower);
  if (exact) return exact;
  const prefixes = table.filter((s) => s.name.toLowerCase().startsWith(lower));
  if (prefixes.length > 0) return prefixes[0];
  return null;
}

/** Live-ish station search for the UI fallback. Exported for /api/railway/stations. */
export async function lookupStationsErail(query: string): Promise<ErailStation[]> {
  const table = await stationTable();
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const upper = query.trim().toUpperCase();
  const exact = table.filter((s) => s.code === upper || s.name.toLowerCase() === q);
  if (exact.length > 0) return exact.slice(0, 10);
  return table.filter((s) => s.name.toLowerCase().includes(q) || s.code.startsWith(upper)).slice(0, 10);
}

/* ---------------- TBS feed ---------------- */

function hhmm(v: string): string {
  const m = /^(\d{1,2})[.:](\d{2})$/.exec(v.trim());
  if (!m) return v.trim();
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/**
 * Parse eRail's getTrains.aspx feed: `^`-separated records, `~`-separated
 * fields (indices verified against the live payload 2026-10-10):
 *   0 trainNumber · 1 trainName · 6/7 from name/code · 8/9 to name/code ·
 *  10 departure (HH.MM) · 11 arrival · 13 runningDays · 32 type ·
 *  62 per-class block "CC:103:118|EA:4|EC:5|"
 * Exported for unit tests.
 */
export function parseErailTbs(body: string): { trains: TrainSummary[]; throttled: boolean } {
  if (/^~~~~~/.test(body.trimStart()) || body.includes("Please try again after some time")) {
    return { trains: [], throttled: true };
  }
  const trains: TrainSummary[] = [];
  let dropped = 0;
  for (const record of body.split("^")) {
    if (!record.trim() || record.startsWith("~~~~~")) continue;
    const f = record.split("~");
    if (f.length < 33 || !/^\d{4,6}$/.test(f[0].trim())) {
      dropped += 1;
      continue;
    }
    // Classes from the per-class block (field 62): "CC:103:118|EA:4|EC:5|"
    let classes: string[] | undefined;
    if (f.length > 62 && f[62].includes(":")) {
      const parsed = f[62]
        .split("|")
        .map((entry) => entry.split(":")[0].trim().toUpperCase())
        .filter((c) => /^[A-Z0-9]{1,3}$/.test(c));
      if (parsed.length > 0) classes = [...new Set(parsed)];
    }
    const candidate = {
      trainNumber: f[0].trim(),
      trainName: f[1].trim(),
      from: { code: f[7].trim().toUpperCase(), name: f[6].trim() || f[7].trim().toUpperCase() },
      to: { code: f[9].trim().toUpperCase(), name: f[8].trim() || f[9].trim().toUpperCase() },
      departure: hhmm(f[10]),
      arrival: hhmm(f[11]),
      classes,
    };
    const parsedRow = TrainSummarySchema.safeParse(candidate);
    if (parsedRow.success) trains.push(parsedRow.data);
    else dropped += 1;
  }
  if (dropped > 0) {
    logger.warn("erail: dropped unparseable TBS records", { count: dropped, requestId: "adapter" });
  }
  return { trains, throttled: false };
}

async function searchTrains(q: TrainSearchQuery, ctx: QueryContext): Promise<ResultEnvelope<TrainSummary[]>> {
  if (!q.from || !q.to) {
    return err(
      ctx.requestId,
      providerError("VALIDATION_FAILED", "The fallback provider needs explicit origin and destination stations.", {
        retryable: false,
      }),
    );
  }
  const from = await resolveErailStation(q.from);
  const to = await resolveErailStation(q.to);
  if (!from || !to) {
    return err(
      ctx.requestId,
      providerError(
        "NOT_FOUND",
        `Fallback station table has no match for "${!from ? q.from : q.to}".`,
        { retryable: false },
      ),
    );
  }

  const cacheKey = `tbs:${from.code}|${to.code}`;
  const hit = cacheGet<TrainSummary[]>(cacheKey);
  if (hit) {
    return okEnvelope({ data: hit, source: SOURCE, ttlSeconds: TBS_TTL_SECONDS, requestId: ctx.requestId });
  }

  const url =
    `${TBS_URL}?Station_From=${encodeURIComponent(from.code)}&Station_To=${encodeURIComponent(to.code)}` +
    `&DataSource=0&Language=0&Cache=true`;
  let body: string;
  try {
    const res = await fetchText(url);
    if (res.status === 429) {
      return err(ctx.requestId, providerError("RATE_LIMITED", "eRail rate-limited the request (HTTP 429).", { retryable: true }));
    }
    if (!res.ok) {
      return err(ctx.requestId, providerError("UPSTREAM_ERROR", `eRail returned HTTP ${res.status}.`, { retryable: true }));
    }
    body = res.body;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err(ctx.requestId, providerError("UPSTREAM_ERROR", `eRail request failed: ${message}`, { retryable: true }));
  }

  const { trains, throttled } = parseErailTbs(body);
  if (throttled) {
    return err(ctx.requestId, providerError("RATE_LIMITED", "eRail is throttling requests right now; retry later.", { retryable: true }));
  }
  if (trains.length === 0) {
    return err(ctx.requestId, providerError("UPSTREAM_ERROR", "eRail returned no parsable train records for this route.", { retryable: true }));
  }
  cacheSet(cacheKey, trains, TBS_TTL_SECONDS * 1000);
  return okEnvelope({ data: trains, source: SOURCE, ttlSeconds: TBS_TTL_SECONDS, requestId: ctx.requestId });
}

/* ---------------- fare (SSR page) ---------------- */

/** Which option is `selected` in the from/to <select>s — exported for tests. */
export function parseSelectedPair(html: string): { from: string | null; to: string | null } {
  const pick = (name: string): string | null => {
    const block = new RegExp(`select name='${name}'[\\s\\S]*?</select>`).exec(html);
    if (!block) return null;
    const m = /<option value='([A-Za-z]{2,5})'\s+selected/.exec(block[0]);
    return m ? m[1].toUpperCase() : null;
  };
  return { from: pick("from"), to: pick("to") };
}

/** Parse the "Total fare for 1 Adult" table → per-class General/Tatkal fares. */
export function parseFareTable(html: string): { headers: string[]; rows: Record<string, Record<string, number>> } | null {
  const anchor = html.indexOf("Total fare for");
  const segment = anchor >= 0 ? html.slice(anchor) : html;
  const table = /<table class='tableSingleFare[^']*'[^>]*>([\s\S]*?)<\/table>/.exec(segment);
  if (!table) return null;
  const headers = [...table[1].matchAll(/<th>([^<]*)<\/th>/g)]
    .map((m) => m[1].trim().toUpperCase())
    .filter(Boolean);
  const rows: Record<string, Record<string, number>> = {};
  for (const tr of table[1].matchAll(/<tr><td>([^<]+)<\/td>([\s\S]*?)<\/tr>/g)) {
    const label = tr[1].trim();
    const cells = [...tr[2].matchAll(/<td>(?:<b>)?([^<]*)(?:<\/b>)?<\/td>/g)].map((m) => m[1].trim());
    const values: Record<string, number> = {};
    cells.forEach((cell, i) => {
      const n = Number(cell.replace(/,/g, ""));
      if (headers[i] && Number.isFinite(n)) values[headers[i]] = n;
    });
    if (Object.keys(values).length > 0) rows[label] = values;
  }
  return headers.length > 0 && Object.keys(rows).length > 0 ? { headers, rows } : null;
}

async function fare(q: FareQuery, ctx: QueryContext): Promise<ResultEnvelope<Fare>> {
  const from = await resolveErailStation(q.from);
  const to = await resolveErailStation(q.to);
  if (!from || !to) {
    return err(
      ctx.requestId,
      providerError("NOT_FOUND", `Fallback station table has no match for "${!from ? q.from : q.to}".`, {
        retryable: false,
      }),
    );
  }
  const trainNo = q.trainId.trim();
  if (!/^\d{4,6}$/.test(trainNo)) {
    return err(ctx.requestId, providerError("VALIDATION_FAILED", "Train number must be 4-6 digits.", { retryable: false }));
  }

  const cacheKey = `fare:${trainNo}|${from.code}|${to.code}`;
  const hit = cacheGet<Fare>(cacheKey);
  if (hit) return okEnvelope({ data: hit, source: SOURCE, ttlSeconds: FARE_TTL_SECONDS, requestId: ctx.requestId });

  let html: string;
  try {
    const res = await fetchText(`${FARE_URL}/${encodeURIComponent(trainNo)}?from=${from.code}&to=${to.code}`);
    if (res.status === 429) {
      return err(ctx.requestId, providerError("RATE_LIMITED", "eRail rate-limited the request (HTTP 429).", { retryable: true }));
    }
    if (!res.ok) {
      return err(ctx.requestId, providerError("UPSTREAM_ERROR", `eRail fare page returned HTTP ${res.status}.`, { retryable: true }));
    }
    html = res.body;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err(ctx.requestId, providerError("UPSTREAM_ERROR", `eRail fare request failed: ${message}`, { retryable: true }));
  }

  // Owner rule: the page silently falls back to the full route when the pair
  // is invalid — verify its own `selected` options; never return a fare that
  // belongs to a different journey.
  const selected = parseSelectedPair(html);
  if (selected.from !== from.code || selected.to !== to.code) {
    return err(
      ctx.requestId,
      providerError(
        "NOT_FOUND",
        `eRail served fares for ${selected.from ?? "?"}→${selected.to ?? "?"}, not the requested ${from.code}→${to.code}; refusing to return a mismatched route fare.`,
        { retryable: false },
      ),
    );
  }

  const table = parseFareTable(html);
  if (!table) {
    return err(ctx.requestId, providerError("NOT_FOUND", `eRail published no fare table for train ${trainNo}.`, { retryable: false }));
  }
  const quota = q.quota?.trim().toUpperCase();
  const rowLabel = quota === "TQ" ? "Tatkal" : "General";
  const row = table.rows[rowLabel];
  const classCode = q.classCode.trim().toUpperCase();
  const amount = row?.[classCode];
  if (amount === undefined) {
    return err(
      ctx.requestId,
      providerError(
        "NOT_FOUND",
        `eRail published no ${rowLabel} fare for class ${classCode} on train ${trainNo} (${from.code}→${to.code}).`,
        { retryable: false },
      ),
    );
  }
  const candidate = {
    trainNumber: trainNo,
    classCode,
    from: { code: from.code, name: from.name },
    to: { code: to.code, name: to.name },
    baseFare: amount,
    totalFare: amount,
    currency: "INR",
  };
  const parsed = FareSchema.safeParse(candidate);
  if (!parsed.success) {
    return err(ctx.requestId, providerError("VALIDATION_FAILED", "eRail fare payload failed domain validation.", { retryable: false }));
  }
  cacheSet(cacheKey, parsed.data, FARE_TTL_SECONDS * 1000);
  return okEnvelope({ data: parsed.data, source: SOURCE, ttlSeconds: FARE_TTL_SECONDS, requestId: ctx.requestId });
}

/* ---------------- adapter ---------------- */

export const erailAdapter: TrainSearchProvider & FareProvider = {
  id: "erail-v1",
  capabilities: ["trainSearch", "fare"],
  termsRef: "docs/provider-terms.md#erail-v1",
  /** Keyless public endpoint — activation is by RAILWAY_PROVIDER_IDS only. */
  credentialRequired: false,
  priority: 200,
  async health() {
    const started = Date.now();
    try {
      const res = await fetchText(`${TBS_URL}?Station_From=NDLS&Station_To=CNB&DataSource=0&Language=0&Cache=true`);
      const { throttled } = parseErailTbs(res.body);
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
  fare,
};
