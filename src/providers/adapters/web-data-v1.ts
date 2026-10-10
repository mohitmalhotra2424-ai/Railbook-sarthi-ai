/**
 * web-data-v1 — community-accessible web sources for the two capabilities no
 * structured API covers: timetable (static schedule) and live running status.
 * Owner-authorized 2026-10-10 (docs/provider-terms.md#web-data-v1), including
 * the owner-supplied source chains and browser-header recipe.
 *
 * timetable chain (owner order — FIRST source yielding ≥3 stops wins):
 *   1. https://www.ixigo.com/trains/{num}
 *   2. https://www.confirmtkt.com/train-schedule/{num}
 *   3. https://www.trainspnrstatus.com/train-schedule/{num}
 *   All fail → honest UPSTREAM_ERROR, never a fabricated schedule.
 *
 * liveStatus chain:
 *   1. https://livestatus.railyatri.in/api/v3/train_eta_data/{num}/{daysBack}.json?start_day=0
 *      (daysBack 0, then 1 for overnight runs)
 *   2. https://www.railyatri.in/live-train-status/{num}-train  (__NEXT_DATA__.ltsData)
 *   3. https://railenquiry.in/runningstatus/{num}              (NTES mirror, best effort)
 *
 * Owner rules implemented verbatim:
 *  - browser-like headers (Sec-Fetch-*, Accept-Language en-IN, same-origin Referer)
 *  - 9 s timeout per source
 *  - `if (!res.ok) return null` → next source is tried (403 handling)
 *  - first schedule source with 3+ stops wins; all fail → null (honest empty)
 */

import { providerError } from "@/domain/errors";
import { LiveStatusSchema, TimetableSchema, type LiveStatus, type Timetable, type TimetableEntry } from "@/domain/schemas";
import { errorEnvelope, okEnvelope } from "@/providers/envelope";
import type {
  LiveStatusProvider,
  QueryContext,
  ResultEnvelope,
  SourceInfo,
  TimetableProvider,
} from "@/providers/types";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 9_000;
const SCHEDULE_TTL_SECONDS = 6 * 3600;
const LIVE_TTL_SECONDS = 60;

const SOURCE: SourceInfo = {
  providerId: "web-data-v1",
  kind: "authorized-partner",
  termsRef: "docs/provider-terms.md#web-data-v1",
  authorization: "configured",
};

/* ---------------- fetch (owner's browser-header recipe) ---------------- */

function browserHeaders(url: string): Record<string, string> {
  return {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*",
    "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    Referer: `https://${new URL(url).hostname}/`,
  };
}

/** Owner rule: `if (!res.ok) return null` — a 403/500 means "try next source". */
async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: browserHeaders(url),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/* ---------------- caches ---------------- */

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}
const cache = new Map<string, CacheEntry>();

/** Test hook — clears every cached upstream response. */
export function __clearWebDataCaches(): void {
  cache.clear();
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
  if (cache.size > 200) cache.clear();
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

/* ---------------- shared HTML helpers ---------------- */

function stripTags(fragment: string): string {
  return fragment.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function cells(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
}

function rowsOf(html: string): string[] {
  return html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
}

function timeOrNull(v: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

function extractTrainName(html: string, trainNumber: string): string {
  const clean = (raw: string): string =>
    raw
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(trainNumber, " ")
      .split(/[|:–—]/)[0]
      .replace(
        /\b(train route|train schedule|time ?table|timetable|route|running status|live status|live|schedule|status|and|the|of|&)\b/gi,
        " ",
      )
      .replace(/[(),]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  // h1 first (confirmtkt puts the name there; its <title> often lacks it),
  // then <title>; otherwise an explicit placeholder — never a guessed name.
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const fromH1 = h1 ? clean(h1) : "";
  if (fromH1.length >= 3) return fromH1;
  const title = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1] ?? "";
  const fromTitle = clean(title);
  if (fromTitle.length >= 3) return fromTitle;
  return `Train ${trainNumber}`;
}

/* ---------------- schedule parsers (exported for tests) ---------------- */

/** ixigo: best-effort. Their page ships no server-rendered stop data today
 *  (verified 2026-10-10: zero station keys in the payload) — returns []. */
export function parseIxigoSchedule(html: string): TimetableEntry[] {
  const out: TimetableEntry[] = [];
  for (const row of rowsOf(html)) {
    const c = cells(row);
    const codeCell = c.find((v) => /^[A-Z]{2,5}$/.test(v));
    const times = c.map(timeOrNull).filter((t): t is string => t !== null);
    if (!codeCell || times.length === 0 || !/^\d{1,3}$/.test(c[0] ?? "")) continue;
    const nameCell = c.find((v) => v.length > 2 && v !== codeCell && !timeOrNull(v));
    out.push({
      sequence: Number(c[0]),
      station: { code: codeCell, name: nameCell ?? codeCell },
      arrival: times[0] ?? null,
      departure: times[1] ?? times[0] ?? null,
      platform: null,
    });
  }
  return out;
}

/** trainspnrstatus: `<td>` cells [seq, name, code, arr, dep, halt, ...]. */
export function parseTrainSpnrSchedule(html: string): TimetableEntry[] {
  const out: TimetableEntry[] = [];
  for (const row of rowsOf(html)) {
    const c = cells(row);
    if (c.length < 5 || !/^\d{1,3}$/.test(c[0]) || !/^[A-Z]{2,5}$/.test(c[2] ?? "")) continue;
    const arr = timeOrNull(c[3] ?? "");
    const dep = timeOrNull(c[4] ?? "");
    if (!arr && !dep) continue;
    const halt = /^\d{1,4}$/.test(c[6] ?? "") ? Number(c[6]) : null;
    out.push({
      sequence: Number(c[0]),
      station: { code: c[2], name: c[1] || c[2] },
      arrival: arr,
      departure: dep,
      haltMinutes: halt,
      platform: null,
    });
  }
  return out;
}

/** confirmtkt: rows contain "Name - CODE"; times are the HH:MM cells;
 *  Start/End rows null the missing side. */
export function parseConfirmTktSchedule(html: string): TimetableEntry[] {
  const out: TimetableEntry[] = [];
  for (const row of rowsOf(html)) {
    const c = cells(row);
    const nameCodeIdx = c.findIndex((v) => /^(.+?)\s+-\s+([A-Z]{2,5})$/.test(v));
    if (nameCodeIdx < 1) continue;
    const seqCell = c.slice(0, nameCodeIdx).find((v) => /^\d{1,3}$/.test(v));
    if (!seqCell) continue;
    const m = /^(.+?)\s+-\s+([A-Z]{2,5})$/.exec(c[nameCodeIdx])!;
    const times = c.map(timeOrNull).filter((t): t is string => t !== null);
    if (times.length === 0) continue;
    const joined = c.join(" ").toLowerCase();
    const isSource = /\bstart\b|\bsource\b/.test(joined);
    const isDest = /\bend\b|\bdestination\b/.test(joined);
    out.push({
      sequence: Number(seqCell),
      station: { code: m[2], name: m[1].trim() },
      arrival: isSource ? null : (times[0] ?? null),
      departure: isDest ? null : (isSource ? (times[0] ?? null) : (times[1] ?? times[0] ?? null)),
      platform: null,
    });
  }
  return out;
}

/* ---------------- live status parsers (exported for tests) ---------------- */

type LtsShape = Record<string, unknown>;

/** Shared by the eta JSON API and __NEXT_DATA__.ltsData (identical shape —
 *  verified against both payloads 2026-10-10). */
export function parseLtsPayload(obj: LtsShape): LiveStatus | null {
  if (obj.success !== true) return null;
  const num = String(obj.train_number ?? "").trim();
  if (!/^\d{4,6}$/.test(num)) return null;
  const isRunDay = obj.is_run_day === true;
  const atDstn = obj.at_dstn === true;
  const code = typeof obj.current_station_code === "string" ? obj.current_station_code.trim().toUpperCase() : "";
  const name = typeof obj.current_station_name === "string" ? obj.current_station_name.replace(/~+$/, "").trim() : "";
  const delay = Number(obj.delay);
  const candidate = {
    trainNumber: num,
    trainName: typeof obj.train_name === "string" && obj.train_name.trim() ? obj.train_name.trim() : `Train ${num}`,
    running: isRunDay ? !atDstn : false,
    lastStation: /^[A-Z]{2,5}$/.test(code) ? { code, name: name || code } : null,
    delayMinutes: Number.isFinite(delay) ? Math.round(delay) : null,
    updatedAt: typeof obj.status_as_of === "string" && obj.status_as_of.trim() ? obj.status_as_of.trim() : null,
  };
  const parsed = LiveStatusSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function extractLtsFromNextData(html: string): LtsShape | null {
  const m = /__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  let root: unknown;
  try {
    root = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const find = (o: unknown, depth: number): LtsShape | null => {
    if (!o || typeof o !== "object" || depth > 8) return null;
    const rec = o as Record<string, unknown>;
    if (rec.ltsData && typeof rec.ltsData === "object") return rec.ltsData as LtsShape;
    for (const value of Object.values(rec)) {
      const hit = find(value, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return find(root, 0);
}

/** railenquiry (NTES mirror): the page is JS-hydrated; only usable if a
 *  server-rendered JSON blob is present. Best effort — returns null today. */
export function parseRailenquiry(html: string): LiveStatus | null {
  const m = /"train_number"\s*:\s*"?(\d{4,6})"?[\s\S]*?"delay"\s*:\s*(-?\d+)/.exec(html);
  if (!m) return null;
  const candidate = {
    trainNumber: m[1],
    trainName: `Train ${m[1]}`,
    running: true,
    lastStation: null,
    delayMinutes: Number(m[2]),
    updatedAt: null,
  };
  const parsed = LiveStatusSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/* ---------------- capability implementations ---------------- */

function istTodayIso(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

const SCHEDULE_CHAIN = [
  { name: "ixigo", url: (n: string) => `https://www.ixigo.com/trains/${n}`, parse: parseIxigoSchedule },
  { name: "confirmtkt", url: (n: string) => `https://www.confirmtkt.com/train-schedule/${n}`, parse: parseConfirmTktSchedule },
  { name: "trainspnrstatus", url: (n: string) => `https://www.trainspnrstatus.com/train-schedule/${n}`, parse: parseTrainSpnrSchedule },
] as const;

async function timetable(
  trainId: string,
  date: string | undefined,
  ctx: QueryContext,
): Promise<ResultEnvelope<Timetable>> {
  const num = trainId.trim();
  if (!/^\d{4,6}$/.test(num)) {
    return {
      ...errorEnvelope({
        source: SOURCE,
        errors: [providerError("VALIDATION_FAILED", "Train number must be 4-6 digits.", { retryable: false })],
        requestId: ctx.requestId,
      }),
      data: null,
    };
  }
  const cacheKey = `sched:${num}`;
  const cached = ctx.refresh === true ? undefined : cacheGet<Timetable>(cacheKey);
  if (cached) {
    return okEnvelope({
      data: { ...cached, date: date?.trim() || istTodayIso() },
      source: SOURCE,
      ttlSeconds: SCHEDULE_TTL_SECONDS,
      requestId: ctx.requestId,
    });
  }

  const tried: string[] = [];
  for (const step of SCHEDULE_CHAIN) {
    const html = await fetchPage(step.url(num));
    if (html === null) {
      tried.push(`${step.name}: unreachable/blocked`);
      continue;
    }
    const entries = step.parse(html);
    // Owner rule: first source yielding 3+ stops wins.
    if (entries.length >= 3) {
      const candidate = {
        trainNumber: num,
        trainName: extractTrainName(html, num),
        date: date?.trim() || istTodayIso(),
        entries,
      };
      const parsed = TimetableSchema.safeParse(candidate);
      if (parsed.success) {
        cacheSet(cacheKey, parsed.data, SCHEDULE_TTL_SECONDS * 1000);
        return okEnvelope({ data: parsed.data, source: SOURCE, ttlSeconds: SCHEDULE_TTL_SECONDS, requestId: ctx.requestId });
      }
      tried.push(`${step.name}: parsed ${entries.length} stops but failed validation`);
      continue;
    }
    tried.push(`${step.name}: only ${entries.length} stops`);
  }

  return {
    ...errorEnvelope({
      source: SOURCE,
      errors: [
        providerError(
          "UPSTREAM_ERROR",
          `No schedule source returned a usable timetable for train ${num} (${tried.join("; ")}).`,
          { retryable: true },
        ),
      ],
      requestId: ctx.requestId,
    }),
    data: null,
  };
}

async function liveStatus(
  trainId: string,
  date: string,
  ctx: QueryContext,
): Promise<ResultEnvelope<LiveStatus>> {
  const num = trainId.trim();
  if (!/^\d{4,6}$/.test(num)) {
    return {
      ...errorEnvelope({
        source: SOURCE,
        errors: [providerError("VALIDATION_FAILED", "Train number must be 4-6 digits.", { retryable: false })],
        requestId: ctx.requestId,
      }),
      data: null,
    };
  }
  const cacheKey = `live:${num}`;
  const cached = ctx.refresh === true ? undefined : cacheGet<LiveStatus>(cacheKey);
  if (cached) {
    return okEnvelope({ data: cached, source: SOURCE, ttlSeconds: LIVE_TTL_SECONDS, requestId: ctx.requestId });
  }

  // 1) RailYatri eta API — daysBack 0 (started today), then 1 (overnight runs).
  for (const daysBack of [0, 1]) {
    const body = await fetchPage(
      `https://livestatus.railyatri.in/api/v3/train_eta_data/${num}/${daysBack}.json?start_day=0`,
    );
    if (body) {
      try {
        const status = parseLtsPayload(JSON.parse(body) as LtsShape);
        if (status) {
          cacheSet(cacheKey, status, LIVE_TTL_SECONDS * 1000);
          return okEnvelope({ data: status, source: SOURCE, ttlSeconds: LIVE_TTL_SECONDS, requestId: ctx.requestId });
        }
      } catch {
        // not JSON — fall through to next source
      }
    }
  }

  // 2) RailYatri live page (__NEXT_DATA__.ltsData).
  const page = await fetchPage(`https://www.railyatri.in/live-train-status/${num}-train`);
  if (page) {
    const lts = extractLtsFromNextData(page);
    if (lts) {
      const status = parseLtsPayload(lts);
      if (status) {
        cacheSet(cacheKey, status, LIVE_TTL_SECONDS * 1000);
        return okEnvelope({ data: status, source: SOURCE, ttlSeconds: LIVE_TTL_SECONDS, requestId: ctx.requestId });
      }
    }
  }

  // 3) railenquiry.in (NTES mirror) — best effort.
  const rePage = await fetchPage(`https://railenquiry.in/runningstatus/${num}`);
  if (rePage) {
    const status = parseRailenquiry(rePage);
    if (status) {
      cacheSet(cacheKey, status, LIVE_TTL_SECONDS * 1000);
      return okEnvelope({ data: status, source: SOURCE, ttlSeconds: LIVE_TTL_SECONDS, requestId: ctx.requestId });
    }
  }

  return {
    ...errorEnvelope({
      source: SOURCE,
      errors: [
        providerError(
          "UPSTREAM_ERROR",
          `No live-status source answered for train ${num} on ${date}.`,
          { retryable: true },
        ),
      ],
      requestId: ctx.requestId,
    }),
    data: null,
  };
}

export const webDataAdapter: TimetableProvider & LiveStatusProvider = {
  id: "web-data-v1",
  capabilities: ["timetable", "liveStatus"],
  termsRef: "docs/provider-terms.md#web-data-v1",
  credentialRequired: false,
  priority: 100,
  async health() {
    const started = Date.now();
    const body = await fetchPage("https://livestatus.railyatri.in/api/v3/train_eta_data/12904/0.json?start_day=0");
    let ok = false;
    if (body) {
      try {
        ok = (JSON.parse(body) as LtsShape).success === true;
      } catch {
        ok = false;
      }
    }
    return {
      ok,
      latencyMs: Date.now() - started,
      errors: ok ? [] : [providerError("UPSTREAM_ERROR", "web-data health check failed.", { retryable: true })],
    };
  },
  timetable,
  liveStatus,
};
