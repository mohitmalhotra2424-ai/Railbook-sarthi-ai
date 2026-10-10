/**
 * railyatri-seat-v1 — seat availability from RailYatri's public web enquiry
 * endpoint (the same one railyatri.in's own seat-availability page calls).
 * Owner-authorized 2026-10-10 (RailYatri scraping authorization).
 *
 * CREDENTIAL-GATED: RailYatri's gateway rejects requests without a genuine
 * registered user id ("Invalid User Id."). This adapter therefore stays
 * INACTIVE until the owner supplies their id via
 *   RAILWAY_PROVIDER_RAILYATRI_SEAT_V1_KEY=<user id>
 * and lists "railyatri-seat-v1" in RAILWAY_PROVIDER_IDS. Until then the
 * executor reports honest NOT_CONFIGURED for this adapter — never mock data.
 *
 * The response parser below is written defensively against the field names
 * found in RailYatri's own JS bundle (seat_availibility, class_type, …).
 * Because the gateway is blocked without a real user id, the parser has NOT
 * been verified against a live success payload — unit tests use fixtures and
 * are labelled as such. Any unexpected shape → VALIDATION_FAILED (honest
 * error), never invented availability.
 */
import { okEnvelope, errorEnvelope } from "@/providers/envelope";
import { providerError, type ProviderError } from "@/domain/errors";
import { providerKeyEnvName } from "@/providers/config";
import { AvailabilitySchema, type Availability, type AvailabilityClass } from "@/domain/schemas";
import type {
  QueryContext,
  ResultEnvelope,
  SeatAvailabilityProvider,
  SeatAvailabilityQuery,
  SourceInfo,
} from "@/providers/types";

/** Error envelope typed for this adapter's success shape (data stays null). */
function failed(
  errors: ReturnType<typeof providerError>[],
  requestId: string,
): ResultEnvelope<Availability> {
  return { ...errorEnvelope({ source: SOURCE, errors, requestId }), data: null } as ResultEnvelope<Availability>;
}

const HOST = "https://sa.railyatri.in";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const SOURCE: SourceInfo = {
  providerId: "railyatri-seat-v1",
  kind: "authorized-partner",
  termsRef: "docs/provider-terms.md#railyatri-seat-v1",
  authorization: "configured",
};

const TTL_SECONDS = 60;
const FETCH_TIMEOUT_MS = 12_000;
/** Classes queried in parallel when the caller did not name one. */
const DEFAULT_CLASSES = ["SL", "3A", "2A", "1A"];
const STATION_CODE_RX = /^[A-Z]{3,5}$/;
const STATUS_RX = /^(AVAILABLE[- ]?\d*|AVBL[- ]?\d*|AVL[- ]?\d*|WL ?\d*|RAC ?\d*|REGRET|CNF|CURR AVL|NOT AVAILABLE|[A-Z]{2,}WL ?\d*)$/i;

/* ---------------- polite in-memory cache ---------------- */
interface CacheEntry {
  expiresAt: number;
  value: AvailabilityClass[];
}
const cache = new Map<string, CacheEntry>();
export function __clearRailYatriSeatCaches(): void {
  cache.clear();
}

/* ---------------- parsing (defensive; exported for unit tests) ------------- */

function classDataToStatus(data: unknown): { status: string; seatsText: string | null } | null {
  if (typeof data === "string") {
    const t = data.trim();
    if (!t || !STATUS_RX.test(t)) return null;
    return { status: t, seatsText: t };
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const status = [obj.status, obj.current_status, obj.avail_status, obj.seat_status].find(
      (v): v is string => typeof v === "string" && v.trim().length > 0,
    );
    if (!status || !STATUS_RX.test(status.trim())) return null;
    const count = [obj.seat_count, obj.count, obj.seats, obj.availability].find(
      (v): v is string | number => (typeof v === "string" && v.trim() !== "") || typeof v === "number",
    );
    return {
      status: status.trim(),
      seatsText: count !== undefined ? String(count) : status.trim(),
    };
  }
  return null;
}

/**
 * RailYatri success shape (from their JS bundle):
 *   { success: true, seat_availibility: [ { class_type: "3A", "3A": <data>, … } ],
 *     availablity_date?: string, alt_seat_status?: … }
 * `seat_availibility[0]` holds the requested class under its own code.
 * Returns null when the shape is not what we expect (→ VALIDATION_FAILED).
 */
export function parseSeatEnquiry(
  json: Record<string, unknown>,
  classCode: string,
): { cls: AvailabilityClass; asOfDate: string | null } | null {
  const list = json.seat_availibility;
  if (!Array.isArray(list) || list.length === 0) return null;
  const first = list[0] as Record<string, unknown> | undefined;
  if (!first || typeof first !== "object") return null;
  const data = first[classCode] ?? first[first.class_type as string];
  const parsed = classDataToStatus(data);
  if (!parsed) return null;
  const asOfDate =
    typeof json.availablity_date === "string" && json.availablity_date.trim()
      ? json.availablity_date.trim()
      : null;
  return { cls: { classCode, ...parsed, asOf: asOfDate }, asOfDate };
}

/* ---------------- fetching ---------------- */

function toDdMmYyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

async function fetchClass(
  trainId: string,
  dateIso: string,
  from: string,
  to: string,
  classCode: string,
  userId: string,
): Promise<AvailabilityClass | null> {
  const key = `av:${trainId}:${from}:${to}:${dateIso}:${classCode}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value[0] ?? null;

  const params = new URLSearchParams({
    device_type_id: "6",
    src: "ttb_landing",
    utm_source: "web",
    is_update: "true",
    update_duration: "0",
    d_day: "0",
    train_source: from,
    train_destination: to,
    v_code: "",
    user_id: userId,
  });
  const url = `${HOST}/api/seat/enquiry/${trainId}/${toDdMmYyyy(dateIso)}/${from}/${to}/${classCode}/GN.json?${params}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.railyatri.in/" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw providerError(
      "UPSTREAM_ERROR",
      `RailYatri seat enquiry failed (HTTP ${res.status})`,
      { retryable: res.status === 429 || res.status >= 500 },
    );
  }
  const json = (await res.json()) as Record<string, unknown>;
  if (json.success === false) {
    const msg = typeof json.message === "string" ? json.message : "unknown error";
    // "Invalid User Id." is a credential/config problem — not retryable.
    throw providerError("UPSTREAM_ERROR", `RailYatri seat enquiry rejected the request: ${msg}`, {
      retryable: !/invalid user id/i.test(msg),
    });
  }
  const parsed = parseSeatEnquiry(json, classCode);
  if (!parsed) return null; // shape unexpected — caller reports honestly
  cache.set(key, { expiresAt: Date.now() + TTL_SECONDS * 1000, value: [parsed.cls] });
  return parsed.cls;
}

async function availability(
  q: SeatAvailabilityQuery,
  ctx: QueryContext,
): Promise<ResultEnvelope<Availability>> {
  const userId = process.env[providerKeyEnvName("railyatri-seat-v1")]?.trim();
  if (!userId) {
    return failed(
      [providerError("NOT_CONFIGURED", "RailYatri user id is not configured for this adapter.", { retryable: false })],
      ctx.requestId,
    );
  }

  const from = q.from.trim().toUpperCase();
  const to = q.to.trim().toUpperCase();
  if (!STATION_CODE_RX.test(from) || !STATION_CODE_RX.test(to)) {
    return failed(
      [providerError("VALIDATION_FAILED", "railyatri-seat-v1 needs station CODES (e.g. ASR, NDLS), not names.", { retryable: false })],
      ctx.requestId,
    );
  }

  const classesToQuery = q.classCode ? [q.classCode.trim().toUpperCase()] : DEFAULT_CLASSES;
  if (ctx.refresh === true) {
    for (const c of classesToQuery) cache.delete(`av:${q.trainId}:${from}:${to}:${q.date}:${c}`);
  }

  // Run classes sequentially: RailYatri rate-limits, and a credential/config
  // rejection on the first class makes the remaining ones pointless.
  const classes: AvailabilityClass[] = [];
  const failures: ProviderError[] = [];
  let configRejected: ProviderError | null = null;
  for (const c of classesToQuery) {
    try {
      const one = await fetchClass(q.trainId, q.date, from, to, c, userId);
      if (one) classes.push(one);
    } catch (err) {
      // fetchClass throws ProviderError objects (plain) — keep code/message/retryable
      const e =
        err && typeof err === "object" && "code" in err && "message" in err
          ? (err as ProviderError)
          : providerError("UPSTREAM_ERROR", err instanceof Error ? err.message : String(err), { retryable: true });
      if (/invalid user id/i.test(e.message)) {
        configRejected = e;
        break;
      }
      failures.push(e);
    }
  }

  if (configRejected) {
    // Credential/config problem: NOT retryable — retrying cannot succeed.
    return failed([{ ...configRejected, retryable: false }], ctx.requestId);
  }
  if (classes.length === 0) {
    return failed(
      failures.length > 0
        ? failures
        : [providerError("VALIDATION_FAILED", "RailYatri returned a payload we could not verify — no availability claimed.", { retryable: true })],
      ctx.requestId,
    );
  }

  const data: Availability = { trainNumber: q.trainId, date: q.date, from: { code: from, name: from }, to: { code: to, name: to }, classes };
  const parsedData = AvailabilitySchema.safeParse(data);
  if (!parsedData.success) {
    return failed(
      [providerError("VALIDATION_FAILED", "RailYatri availability payload failed domain validation.", { retryable: false })],
      ctx.requestId,
    );
  }
  return okEnvelope({
    data: parsedData.data,
    source: SOURCE,
    ttlSeconds: TTL_SECONDS,
    requestId: ctx.requestId,
  });
}

export const railyatriSeatAdapter: SeatAvailabilityProvider = {
  id: "railyatri-seat-v1",
  capabilities: ["seatAvailability"],
  termsRef: "docs/provider-terms.md#railyatri-seat-v1",
  credentialRequired: true, // owner's RailYatri user id
  priority: 150, // after confirmtkt-v1 (100); used as honest fallback
  async health() {
    const userId = process.env[providerKeyEnvName("railyatri-seat-v1")]?.trim();
    return {
      ok: Boolean(userId),
      latencyMs: 0,
      errors: userId
        ? []
        : [providerError("NOT_CONFIGURED", "RailYatri user id not configured", { retryable: false })],
    };
  },
  availability,
};
