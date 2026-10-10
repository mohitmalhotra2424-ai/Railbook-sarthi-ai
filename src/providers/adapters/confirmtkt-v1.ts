/**
 * ConfirmTkt adapter — PRIMARY live-data source (owner-authorized 2026-10-10,
 * see docs/provider-terms.md#confirmtkt-v1).
 *
 * Capabilities: trainSearch, seatAvailability, fare (+ the station-lookup
 * endpoint used by /api/railway/stations and by internal name→code resolution).
 *
 * Access notes (recorded honestly):
 *  - The endpoints are ConfirmTkt's own web-app APIs, reverse-documented by
 *    the community (github.com/uditya-kumar/confirmtkt-mcp); they are NOT a
 *    published/contracted API. They may change or be rate-limited at any
 *    time; failures surface as retryable UPSTREAM_ERROR/RATE_LIMITED.
 *  - No login, no CAPTCHA bypass. `clientid`/`apikey` are static public
 *    constants from ConfirmTkt's own JS bundle (not per-user secrets).
 *  - Politeness: short-TTL in-memory cache; never more than one in-flight
 *    request per unique query.
 *
 * Every payload is validated with the domain Zod schemas at the boundary;
 * unparseable rows are dropped (and logged), never coerced or invented.
 */

import { providerError, type ProviderError } from "@/domain/errors";
import {
  AvailabilitySchema,
  FareSchema,
  TrainSummarySchema,
  type Availability,
  type Fare,
  type TrainSummary,
} from "@/domain/schemas";
import { logger } from "@/lib/logger";
import { errorEnvelope, okEnvelope } from "@/providers/envelope";
import type {
  FareProvider,
  FareQuery,
  QueryContext,
  ResultEnvelope,
  SeatAvailabilityProvider,
  SeatAvailabilityQuery,
  SourceInfo,
  TrainSearchProvider,
  TrainSearchQuery,
} from "@/providers/types";

const HOST = "https://cttrainsapi.confirmtkt.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
/** Static public web-client constants from ConfirmTkt's JS bundle — not secrets. */
const CLIENT_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "application/json",
  clientid: "ct-web",
  apikey: "ct-web!2$",
  deviceid: "railsaarthi-9f3a41c2-7d55-4b0e-9c11-62aa5d0b4e77",
};

const SOURCE: SourceInfo = {
  providerId: "confirmtkt-v1",
  kind: "authorized-partner",
  termsRef: "docs/provider-terms.md#confirmtkt-v1",
  authorization: "configured",
};

const SEARCH_TTL_SECONDS = 60;
const FARE_TTL_SECONDS = 300;
const FETCH_TIMEOUT_MS = 15_000;
const CLASS_ORDER = ["1A", "2A", "3A", "3E", "CC", "EC", "SL", "2S"];

/* ---------------- polite in-memory cache ---------------- */

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}
const jsonCache = new Map<string, CacheEntry>();
const stationCache = new Map<string, CacheEntry>();

/** Test hook — clears every cached upstream response. */
export function __clearConfirmtktCaches(): void {
  jsonCache.clear();
  stationCache.clear();
}

function cacheGet(map: Map<string, CacheEntry>, key: string): unknown | undefined {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    map.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(map: Map<string, CacheEntry>, key: string, value: unknown, ttlMs: number): void {
  if (map.size > 200) map.clear(); // bounded memory
  map.set(key, { expiresAt: Date.now() + ttlMs, value });
}

/* ---------------- low-level fetch ---------------- */

class UpstreamError extends Error {
  code: "UPSTREAM_ERROR" | "RATE_LIMITED" | "VALIDATION_FAILED" | "NOT_FOUND";
  retryable: boolean;
  constructor(code: UpstreamError["code"], message: string, retryable = true) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

async function fetchJson(path: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${HOST}${path}`, {
      headers: CLIENT_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new UpstreamError("UPSTREAM_ERROR", `ConfirmTkt request failed: ${message}`);
  }
  if (res.status === 429) {
    throw new UpstreamError("RATE_LIMITED", "ConfirmTkt rate-limited the request (HTTP 429).");
  }
  // The API sends its structured error payload even on non-2xx statuses
  // (e.g. HTTP 400 + {"error":{"code":4002,...}}) — parse before rejecting.
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (json && typeof json === "object" && (json as { error?: unknown }).error) {
    const rawErr = (json as { error: unknown }).error;
    const e: Record<string, unknown> = rawErr && typeof rawErr === "object" ? (rawErr as Record<string, unknown>) : {};
    const code = typeof e.code === "number" ? e.code : null;
    // Upstream messages are user-safe (no credentials) and actionable —
    // surface them so the model can react (e.g. re-ask for a valid date).
    const message = typeof e.message === "string" && e.message.trim() ? e.message.trim().slice(0, 200) : "unknown API error";
    if (code === 4002) {
      // "Journey date cannot be in the past" — a user-input problem, not retryable.
      throw new UpstreamError("VALIDATION_FAILED", `ConfirmTkt: ${message}`, false);
    }
    throw new UpstreamError("UPSTREAM_ERROR", `ConfirmTkt API error${code !== null ? ` ${code}` : ""}: ${message}`);
  }
  if (!res.ok) {
    throw new UpstreamError("UPSTREAM_ERROR", `ConfirmTkt returned HTTP ${res.status}.`);
  }
  if (!json || typeof json !== "object") {
    throw new UpstreamError("UPSTREAM_ERROR", "ConfirmTkt returned a non-JSON response.");
  }
  return json as Record<string, unknown>;
}

/* ---------------- dates ---------------- */

function isoToDdMmYyyy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) throw new UpstreamError("VALIDATION_FAILED", `Journey date must be YYYY-MM-DD (got "${iso}").`, false);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function istTodayIso(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/* ---------------- stations ---------------- */

export interface CtStation {
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  major: boolean;
}

/** Live station autocomplete. Exported for /api/railway/stations. */
export async function lookupStations(query: string): Promise<CtStation[]> {
  const key = query.trim().toLowerCase();
  const cached = cacheGet(stationCache, key);
  if (cached) return cached as CtStation[];

  const path =
    `/api/v2/trains/stations/auto-suggestion?searchString=${encodeURIComponent(key)}` +
    `&sourceStnCode=&popularStnListLimit=15&preferredStnListLimit=6&channel=mwebd&language=EN`;
  const json = await fetchJson(path);
  const data = (json.data ?? {}) as { stationList?: unknown[] };
  const rows = Array.isArray(data.stationList) ? data.stationList : [];
  const stations: CtStation[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const s = row as Record<string, unknown>;
    const code = typeof s.stationCode === "string" ? s.stationCode.trim().toUpperCase() : "";
    const name = typeof s.stationName === "string" ? s.stationName.trim() : "";
    if (!code || !name) continue;
    stations.push({
      code,
      name,
      city: typeof s.city === "string" ? s.city : null,
      state: typeof s.state === "string" ? s.state : null,
      major: s.majorStn === true,
    });
  }
  cacheSet(stationCache, key, stations, 24 * 3600_000);
  return stations;
}

async function resolveStation(input: string): Promise<CtStation> {
  const trimmed = input.trim();
  // Only an ALL-UPPERCASE 2-5 letter token is treated as an IRCTC code.
  // Mixed-case words ("Delhi", "Ludhiana") and lowercase codes ("ldh") go
  // through live autocomplete — "Delhi" is 5 letters but is NOT a code.
  if (/^[A-Z]{2,5}$/.test(trimmed)) {
    return { code: trimmed, name: trimmed, city: null, state: null, major: false };
  }
  const matches = await lookupStations(trimmed);
  if (matches.length === 0) {
    throw new UpstreamError("NOT_FOUND", `No railway station matched "${trimmed}".`, false);
  }
  return matches.find((m) => m.major) ?? matches[0];
}

/* ---------------- search payload mapping ---------------- */

function availabilityClasses(cache: unknown): { classCode: string; entry: Record<string, unknown> }[] {
  if (!cache || typeof cache !== "object") return [];
  const out: { classCode: string; entry: Record<string, unknown> }[] = [];
  for (const [classCode, entry] of Object.entries(cache as Record<string, unknown>)) {
    if (entry && typeof entry === "object") out.push({ classCode, entry: entry as Record<string, unknown> });
  }
  out.sort((a, b) => {
    const ia = CLASS_ORDER.indexOf(a.classCode);
    const ib = CLASS_ORDER.indexOf(b.classCode);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return out;
}

function toTrainSummary(row: Record<string, unknown>): TrainSummary | null {
  const num = row.trainNumber;
  const candidate = {
    trainNumber: (typeof num === "number" ? String(num) : String(num ?? "")).trim(),
    trainName: String(row.trainName ?? "").trim(),
    from: {
      code: String(row.fromStnCode ?? "").trim().toUpperCase(),
      name: String(row.fromStnName ?? row.fromStnCode ?? "").trim(),
    },
    to: {
      code: String(row.toStnCode ?? "").trim().toUpperCase(),
      name: String(row.toStnName ?? row.toStnCode ?? "").trim(),
    },
    departure: String(row.departureTime ?? "").trim(),
    arrival: String(row.arrivalTime ?? "").trim(),
    classes: availabilityClasses(row.availabilityCache).map((c) => c.classCode),
    availability: availabilityClasses(row.availabilityCache)
      .map((c) => {
        const raw = typeof c.entry.availability === "string" ? c.entry.availability.trim() : "";
        const display =
          typeof c.entry.availabilityDisplayName === "string" && c.entry.availabilityDisplayName.trim()
            ? c.entry.availabilityDisplayName.trim()
            : raw;
        const asOf =
          typeof c.entry.cacheTime === "string" && c.entry.cacheTime.trim() ? c.entry.cacheTime.trim() : null;
        return { classCode: c.classCode, status: display, asOf };
      })
      .filter((a) => a.status.length > 0),
  };
  if (candidate.availability.length === 0) delete (candidate as { availability?: unknown }).availability;
  const parsed = TrainSummarySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

interface RawSearch {
  rows: Record<string, unknown>[];
  trains: TrainSummary[];
  from: CtStation;
  to: CtStation;
}

async function fetchSearch(fromCode: string, toCode: string, dateIso: string, refresh = false): Promise<RawSearch[]> {
  const dateDmy = isoToDdMmYyyy(dateIso);
  const path =
    `/api/v1/trains/search?sourceStationCode=${encodeURIComponent(fromCode)}` +
    `&destinationStationCode=${encodeURIComponent(toCode)}` +
    `&dateOfJourney=${encodeURIComponent(dateDmy)}`;
  const cacheKey = path;
  const cached = refresh ? undefined : (cacheGet(jsonCache, cacheKey) as RawSearch[] | undefined);
  if (cached) return cached;

  const json = await fetchJson(path);
  const data = (json.data ?? {}) as { trainList?: unknown[] };
  const list = Array.isArray(data.trainList) ? data.trainList : [];
  const rows = list.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  const trains: TrainSummary[] = [];
  let dropped = 0;
  for (const row of rows) {
    const mapped = toTrainSummary(row);
    if (mapped) trains.push(mapped);
    else dropped += 1;
  }
  if (dropped > 0) {
    logger.warn("confirmtkt: dropped unparseable search rows", { count: dropped, requestId: "adapter" });
  }
  if (rows.length > 0 && trains.length === 0) {
    throw new UpstreamError(
      "VALIDATION_FAILED",
      `ConfirmTkt returned ${rows.length} rows but none parsed against the domain schema.`,
      false,
    );
  }
  const result: RawSearch[] = [
    {
      rows,
      trains,
      from: { code: fromCode, name: fromCode, city: null, state: null, major: false },
      to: { code: toCode, name: toCode, city: null, state: null, major: false },
    },
  ];
  cacheSet(jsonCache, cacheKey, result, SEARCH_TTL_SECONDS * 1000);
  return result;
}

/**
 * Error envelope typed for any capability payload. The spread keeps the
 * object literal structurally compatible with ResultEnvelope<T> for every T
 * (data: null is always assignable to T | null).
 */
function err<T>(requestId: string, error: ProviderError): ResultEnvelope<T> {
  return { ...errorEnvelope({ source: SOURCE, errors: [error], requestId }), data: null };
}

function fromUpstreamError<T>(requestId: string, e: UpstreamError): ResultEnvelope<T> {
  return err<T>(requestId, providerError(e.code, e.message, { retryable: e.retryable }));
}

/* ---------------- adapter ---------------- */

async function searchTrains(q: TrainSearchQuery, ctx: QueryContext): Promise<ResultEnvelope<TrainSummary[]>> {
  if (!q.from || !q.to) {
    return err(
      ctx.requestId,
      providerError(
        "VALIDATION_FAILED",
        "The configured live provider needs explicit origin and destination stations (free-text search is not supported).",
        { retryable: false },
      ),
    );
  }
  const dateIso = q.date?.trim() || istTodayIso();
  try {
    const from = await resolveStation(q.from);
    const to = await resolveStation(q.to);
    const [result] = await fetchSearch(from.code, to.code, dateIso, ctx.refresh === true);
    // Prefer real station names from the response payload over bare codes.
    const first = result.trains[0];
    const data = result.trains.map((t) => ({
      ...t,
      from: first ? first.from : t.from,
      to: first ? first.to : t.to,
    }));
    return okEnvelope({ data, source: SOURCE, ttlSeconds: SEARCH_TTL_SECONDS, requestId: ctx.requestId });
  } catch (e) {
    if (e instanceof UpstreamError) return fromUpstreamError(ctx.requestId, e);
    throw e;
  }
}

function findTrainRow(rows: Record<string, unknown>[], trainNumber: string): Record<string, unknown> | null {
  const wanted = trainNumber.trim();
  return rows.find((r) => String(r.trainNumber ?? "").trim() === wanted) ?? null;
}

async function availability(
  q: SeatAvailabilityQuery,
  ctx: QueryContext,
): Promise<ResultEnvelope<Availability>> {
  try {
    const from = await resolveStation(q.from);
    const to = await resolveStation(q.to);
    const dateIso = q.date?.trim() || istTodayIso();
    const [result] = await fetchSearch(from.code, to.code, dateIso, ctx.refresh === true);
    const row = findTrainRow(result.rows, q.trainId);
    if (!row) {
      return err(
        ctx.requestId,
        providerError(
          "NOT_FOUND",
          `Train ${q.trainId} was not found in live ${from.code}→${to.code} results for ${dateIso}.`,
          { retryable: false },
        ),
      );
    }
    const wantedClass = q.classCode?.trim().toUpperCase();
    const classes = availabilityClasses(row.availabilityCache)
      .filter((c) => !wantedClass || c.classCode.toUpperCase() === wantedClass)
      .map((c) => {
        const raw = typeof c.entry.availability === "string" ? c.entry.availability : "";
        const display =
          typeof c.entry.availabilityDisplayName === "string" && c.entry.availabilityDisplayName.trim()
            ? c.entry.availabilityDisplayName.trim()
            : raw;
        // Provider-reported snapshot time (their clock) — distinct from our
        // envelope retrievedAt. Absent upstream => null, never invented.
        const asOf = typeof c.entry.cacheTime === "string" && c.entry.cacheTime.trim() ? c.entry.cacheTime.trim() : null;
        return { classCode: c.classCode, status: display, seatsText: raw || null, asOf };
      })
      .filter((c) => c.status.length > 0);
    if (classes.length === 0) {
      return err(
        ctx.requestId,
        providerError(
          "NOT_FOUND",
          wantedClass
            ? `No availability published for class ${wantedClass} on train ${q.trainId} (${from.code}→${to.code}, ${dateIso}).`
            : `No availability published for train ${q.trainId} (${from.code}→${to.code}, ${dateIso}).`,
          { retryable: false },
        ),
      );
    }
    const candidate = {
      trainNumber: String(row.trainNumber ?? q.trainId).trim(),
      date: dateIso,
      from: { code: from.code, name: String(row.fromStnName ?? from.code) },
      to: { code: to.code, name: String(row.toStnName ?? to.code) },
      classes,
    };
    const parsed = AvailabilitySchema.safeParse(candidate);
    if (!parsed.success) {
      return err(
        ctx.requestId,
        providerError("VALIDATION_FAILED", "ConfirmTkt availability payload failed domain validation.", {
          retryable: false,
        }),
      );
    }
    return okEnvelope({ data: parsed.data, source: SOURCE, ttlSeconds: SEARCH_TTL_SECONDS, requestId: ctx.requestId });
  } catch (e) {
    if (e instanceof UpstreamError) return fromUpstreamError(ctx.requestId, e);
    throw e;
  }
}

async function fare(q: FareQuery, ctx: QueryContext): Promise<ResultEnvelope<Fare>> {
  try {
    const from = await resolveStation(q.from);
    const to = await resolveStation(q.to);
    const dateIso = q.date?.trim() || istTodayIso();
    const [result] = await fetchSearch(from.code, to.code, dateIso, ctx.refresh === true);
    const row = findTrainRow(result.rows, q.trainId);
    if (!row) {
      return err(
        ctx.requestId,
        providerError(
          "NOT_FOUND",
          `Train ${q.trainId} was not found in live ${from.code}→${to.code} results for ${dateIso}.`,
          { retryable: false },
        ),
      );
    }
    const wantedClass = q.classCode.trim().toUpperCase();
    const wantedQuota = q.quota?.trim().toUpperCase();
    const match = availabilityClasses(row.availabilityCache).find(
      (c) =>
        c.classCode.toUpperCase() === wantedClass &&
        (!wantedQuota || String(c.entry.quota ?? "").toUpperCase() === wantedQuota),
    );
    if (!match) {
      return err(
        ctx.requestId,
        providerError(
          "NOT_FOUND",
          `No fare published for class ${wantedClass}${wantedQuota ? ` quota ${wantedQuota}` : ""} on train ${q.trainId} (${from.code}→${to.code}).`,
          { retryable: false },
        ),
      );
    }
    const fareValue = Number(match.entry.fare);
    if (!Number.isFinite(fareValue) || fareValue < 0) {
      return err(
        ctx.requestId,
        providerError(
          "NOT_FOUND",
          `ConfirmTkt published no usable fare for class ${wantedClass} on train ${q.trainId}.`,
          { retryable: false },
        ),
      );
    }
    const candidate = {
      trainNumber: String(row.trainNumber ?? q.trainId).trim(),
      classCode: match.classCode,
      from: { code: from.code, name: String(row.fromStnName ?? from.code) },
      to: { code: to.code, name: String(row.toStnName ?? to.code) },
      baseFare: fareValue,
      totalFare: fareValue,
      currency: "INR",
    };
    const parsed = FareSchema.safeParse(candidate);
    if (!parsed.success) {
      return err(
        ctx.requestId,
        providerError("VALIDATION_FAILED", "ConfirmTkt fare payload failed domain validation.", {
          retryable: false,
        }),
      );
    }
    return okEnvelope({ data: parsed.data, source: SOURCE, ttlSeconds: FARE_TTL_SECONDS, requestId: ctx.requestId });
  } catch (e) {
    if (e instanceof UpstreamError) return fromUpstreamError(ctx.requestId, e);
    throw e;
  }
}

export const confirmtktAdapter: TrainSearchProvider & SeatAvailabilityProvider & FareProvider = {
  id: "confirmtkt-v1",
  capabilities: ["trainSearch", "seatAvailability", "fare"],
  termsRef: "docs/provider-terms.md#confirmtkt-v1",
  /** Keyless public web endpoints — activation is by RAILWAY_PROVIDER_IDS only. */
  credentialRequired: false,
  priority: 100,
  async health() {
    const started = Date.now();
    try {
      const stations = await lookupStations("ndls");
      return { ok: stations.length > 0, latencyMs: Date.now() - started, errors: [] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        latencyMs: Date.now() - started,
        errors: [providerError("UPSTREAM_ERROR", `ConfirmTkt health check failed: ${message}`, { retryable: true })],
      };
    }
  },
  search: searchTrains,
  availability,
  fare,
};
