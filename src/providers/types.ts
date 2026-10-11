import type { ProviderError, ProviderErrorCode } from "@/domain/errors";
import type {
  Availability,
  Disruption,
  Fare,
  LiveStatus,
  PnrStatus,
  Timetable,
  TrainDetails,
  TrainSummary,
} from "@/domain/schemas";
import type { Locale } from "@/lib/i18n";

export type { ProviderError, ProviderErrorCode };

// Re-export domain payload types so adapter authors import from one place.
export type {
  Availability,
  Disruption,
  Fare,
  LiveStatus,
  PnrStatus,
  Timetable,
  TrainDetails,
  TrainSummary,
} from "@/domain/schemas";

export type Freshness = "fresh" | "stale" | "unknown";

export type ProviderKind =
  | "official-api"
  | "authorized-partner"
  | "open-dataset"
  | "none";

/** Requirement 6: every result tracks its source. */
export interface SourceInfo {
  providerId: string;
  kind: ProviderKind;
  /** Reference into docs/provider-terms.md. Required for configured providers. */
  termsRef: string;
  authorization: "configured" | "not-configured";
}

/** Requirement 7: uncertainty is explicit, never silently resolved. */
export interface Contradiction {
  field: string;
  values: { providerId: string; value: unknown }[];
}

/**
 * The ResultEnvelope wraps EVERY railway answer (requirement 6).
 * `data` is `T | null` — unavailability is representable without fabrication.
 */
export interface ResultEnvelope<T> {
  data: T | null;
  source: SourceInfo;
  /** ISO-8601, set by OUR server clock at receipt. */
  retrievedAt: string;
  /**
   * Timestamp supplied by the upstream provider, ONLY when genuinely present
   * and documented (e.g. RailYatri status_as_of). `null` otherwise — never
   * invented. UI must then say freshness cannot be verified by the provider.
   */
  providerTimestamp: string | null;
  /** Computed from retrievedAt + ttlSeconds — never hardcoded (contract-tested). */
  freshness: Freshness;
  ttlSeconds: number;
  errors: ProviderError[];
  confidence: "high" | "medium" | "low";
  contradictions?: Contradiction[];
  requestId: string;
}

export interface QueryContext {
  locale: Locale;
  requestId: string;
  /**
   * True when the user explicitly asked to re-check — adapters bypass their
   * politeness caches and hit the source again. Decided by the LLM via the
   * tools' `refresh` argument; deterministic caching stays a technical
   * safeguard, never a barrier to a fresh check.
   */
  refresh?: boolean;
}

export type Capability =
  | "trainSearch"
  | "trainDetails"
  | "timetable"
  | "liveStatus"
  | "seatAvailability"
  | "fare"
  | "pnr"
  | "cancellations";

export const ALL_CAPABILITIES: readonly Capability[] = [
  "trainSearch",
  "trainDetails",
  "timetable",
  "liveStatus",
  "seatAvailability",
  "fare",
  "pnr",
  "cancellations",
] as const;

export interface ProviderHealth {
  ok: boolean;
  latencyMs: number;
  errors: ProviderError[];
}

/** Base contract every railway data provider must satisfy. */
export interface RailwayProvider {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  /** Non-empty terms record reference — registration is rejected without it. */
  readonly termsRef: string;
  /**
   * False for keyless public endpoints (owner-authorized scraping sources
   * like confirmtkt-v1): activation is by RAILWAY_PROVIDER_IDS alone.
   * Defaults to true — credentials required.
   */
  readonly credentialRequired?: boolean;
  /** Failover order — lower runs first (default 100). */
  readonly priority?: number;
  health(): Promise<ProviderHealth>;
}

/* ---- One interface per capability; each independently replaceable ---- */

export interface TrainSearchQuery {
  text?: string;
  from?: string;
  to?: string;
  date?: string;
}

export interface TrainSearchProvider extends RailwayProvider {
  search(q: TrainSearchQuery, ctx: QueryContext): Promise<ResultEnvelope<TrainSummary[]>>;
}

export interface TrainDetailsProvider extends RailwayProvider {
  details(trainId: string, ctx: QueryContext): Promise<ResultEnvelope<TrainDetails>>;
}

export interface TimetableProvider extends RailwayProvider {
  timetable(
    trainId: string,
    date: string | undefined,
    ctx: QueryContext,
  ): Promise<ResultEnvelope<Timetable>>;
}

export interface LiveStatusProvider extends RailwayProvider {
  liveStatus(
    trainId: string,
    date: string,
    ctx: QueryContext,
  ): Promise<ResultEnvelope<LiveStatus>>;
}

export interface SeatAvailabilityQuery {
  trainId: string;
  date: string;
  from: string;
  to: string;
  classCode?: string;
}

export interface SeatAvailabilityProvider extends RailwayProvider {
  availability(
    q: SeatAvailabilityQuery,
    ctx: QueryContext,
  ): Promise<ResultEnvelope<Availability>>;
}

export interface FareQuery {
  trainId: string;
  from: string;
  to: string;
  classCode: string;
  quota?: string;
  /** ISO date — availability-linked fares (dynamic pricing) are date-specific. */
  date?: string;
}

export interface FareProvider extends RailwayProvider {
  fare(q: FareQuery, ctx: QueryContext): Promise<ResultEnvelope<Fare>>;
}

export interface PnrProvider extends RailwayProvider {
  pnr(pnr: string, ctx: QueryContext): Promise<ResultEnvelope<PnrStatus>>;
}

export interface CancellationsQuery {
  date?: string;
  zone?: string;
  trainId?: string;
}

export interface CancellationsProvider extends RailwayProvider {
  cancellations(
    q: CancellationsQuery,
    ctx: QueryContext,
  ): Promise<ResultEnvelope<Disruption[]>>;
}

/**
 * Requirement 9: interface ONLY. No implementation may ship until an
 * authorized booking integration is supplied and recorded in
 * docs/provider-terms.md. The booking gate checks for a registered
 * implementation AND BOOKING_ENABLED=true; both are false in Phase 1.
 */
export interface BookingProvider {
  readonly id: string;
  readonly termsRef: string;
}
