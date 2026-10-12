/**
 * Server-side conversation store (requirement 3).
 *
 * This is deliberately a STORE, not a dialogue engine: it records messages,
 * compact journey context and authoritative tool-result references, and it
 * enforces freshness/invalidation bookkeeping. It never interprets user
 * intent and never decides replies — the LLM receives this context and
 * decides everything conversational.
 *
 * Phase-appropriate storage: in-memory LRU (single instance). A persistent
 * store (Redis/DB) slots in behind this interface in Phase 3.
 */

import type { ToolResult } from "@/assistant/tools/results";
import { evaluateReadiness } from "@/assistant/booking/preparation";

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface ResultRef {
  refId: string;
  tool: string;
  correlationId: string;
  status: ToolResult["status"];
  retrievedAt?: string;
  freshness?: string;
  journeyDate?: string;
  route?: { from?: string; to?: string };
  classCode?: string;
  trainNumber?: string;
  /** Authoritative rows — the COMPLETE current provider result set, never
   *  truncated for validation; SELECT_TRAIN resolves against all of it. The
   *  LLM's rendered context shows only the first MAX_CONTEXT_ITEMS (compact
   *  per-row labels keep memory bounded even for oversized payloads). */
  items?: { index: number; label: string; classes?: string[] }[];
  summary?: string;
  /** Prompt 33: provider-returned fare (only when a GET_FARE result was ok). */
  fare?: { classCode: string; totalFare: number; currency: string };
  /** Prompt 33: provider-returned per-class availability (CHECK_AVAILABILITY ok). */
  availability?: { classCode: string; status: string }[];
  supersededBy?: string;
  supersededReason?: string;
}

export interface JourneyContext {
  from?: string;
  to?: string;
  date?: string;
  trainNumber?: string;
  trainName?: string;
  classCode?: string;
}

/** Prompt 25 — explicit, backend-validated train/class selection state. */
export interface SelectionState {
  trainNumber: string;
  trainName?: string;
  from?: string;
  to?: string;
  journeyDate?: string;
  /** Classes the provider actually returned for this train. */
  classes?: string[];
  classCode?: string;
  selectedAt: string;
}

export interface PassengerDraft {
  name?: string;
  age?: number;
  gender?: "male" | "female" | "other";
  /** Berth preference is a REQUEST only — no authorised provider verifies options. */
  berth?: string;
}

export const MAX_PASSENGERS = 6;
/** Required passenger fields — derived from the form schema, not invented per-turn.
 *  Prompt 31 (owner rule): EVERY form field is mandatory before review, so the
 *  berth preference (still a request-only, unverified value) is required too. */
export const REQUIRED_PASSENGER_FIELDS = ["name", "age", "gender", "berth"] as const;

/** Prompt 31 — review/confirmation boundary (deterministic, backend-authoritative). */
export type ReviewStatus = "awaiting_confirmation" | "confirmed";
export interface ReviewState {
  version: number;
  builtAt: string;
  status: ReviewStatus;
  /** Deterministic snapshot of booking-critical fields at build time. */
  snapshot: string;
}

export interface Conversation {
  id: string;
  createdAt: string;
  updatedAt: string;
  currentTurnId: string | null;
  messages: StoredMessage[];
  results: ResultRef[];
  journey: JourneyContext;
  selection?: SelectionState;
  passengers: PassengerDraft[];
  refCounter: number;
  /** Prompt 31 — current review, if any; invalidated on any critical change. */
  review?: ReviewState;
}

const MAX_CONVERSATIONS = 200;
const MAX_MESSAGES = 16; // ~8 turns of text; structured context carries the rest
const MAX_RESULT_REFS = 8;
/** The LLM's conversational rendering shows only the first N items. The
 *  AUTHORITATIVE list itself is never truncated — selection validates
 *  against every row the provider returned (no arbitrary backend cap). */
const MAX_CONTEXT_ITEMS = 8;
const TTL_MS = 2 * 60 * 60 * 1000;

export class ConversationStore {
  private readonly conversations = new Map<string, Conversation>();

  getOrCreate(id: string): Conversation {
    const existing = this.conversations.get(id);
    if (existing) {
      // LRU touch
      this.conversations.delete(id);
      this.conversations.set(id, existing);
      return existing;
    }
    const conv: Conversation = {
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentTurnId: null,
      messages: [],
      results: [],
      journey: {},
      passengers: [],
      refCounter: 0,
    };
    this.conversations.set(id, conv);
    this.evict();
    return conv;
  }

  get(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  /** Starts a turn: records the user message and marks the active turn. */
  beginTurn(id: string, turnId: string, userMessage: string): Conversation {
    const conv = this.getOrCreate(id);
    conv.currentTurnId = turnId;
    conv.messages.push({ role: "user", content: userMessage, at: new Date().toISOString() });
    this.prune(conv);
    conv.updatedAt = new Date().toISOString();
    return conv;
  }

  appendAssistant(id: string, text: string): void {
    const conv = this.conversations.get(id);
    if (!conv) return;
    conv.messages.push({ role: "assistant", content: text, at: new Date().toISOString() });
    this.prune(conv);
    conv.updatedAt = new Date().toISOString();
  }

  /**
   * Records a tool result into the structured context.
   *
   * STALE-TURN GUARD: if the user already started a newer turn (e.g. they
   * interrupted or corrected mid-flight), results belonging to the older
   * turn are NOT allowed to overwrite the journey context.
   */
  recordToolResult(
    id: string,
    turnId: string,
    tool: string,
    args: Record<string, unknown> | null,
    result: ToolResult,
  ): ResultRef | null {
    const conv = this.conversations.get(id);
    if (!conv) return null;
    if (conv.currentTurnId !== turnId) return null; // stale turn — refuse to overwrite

    const refId = `r${++conv.refCounter}`;
    const a = (args ?? {}) as Record<string, string | undefined>;

    const ref: ResultRef = {
      refId,
      tool,
      correlationId: result.correlationId,
      status: result.status,
      retrievedAt: result.retrievedAt,
      freshness: result.freshness,
      journeyDate: result.journeyDate ?? a.date,
      route: a.from || a.to ? { from: a.from, to: a.to } : undefined,
      classCode: result.classCode ?? a.classCode,
      trainNumber: a.trainNumber ?? a.pnr,
      items: compactItems(result.data),
      summary: compactSummary(result),
      fare: compactFare(result.data),
      availability: compactAvailability(result.data),
    };

    // Invalidation: a new search/availability run for a different date or
    // route supersedes earlier ones — the LLM sees explicit SUPERSEDED marks.
    if (tool === "SEARCH_TRAINS" || tool === "CHECK_AVAILABILITY") {
      for (const old of conv.results) {
        if (old.supersededBy || old.tool !== tool) continue;
        const dateChanged = ref.journeyDate && old.journeyDate && ref.journeyDate !== old.journeyDate;
        const routeChanged =
          ref.route?.from &&
          old.route?.from &&
          (ref.route.from !== old.route.from || (ref.route.to ?? "") !== (old.route.to ?? ""));
        // A newer SEARCH_TRAINS for the SAME route+date is a newer result
        // version — the older list must not stay selectable alongside it.
        const sameJourneyRefresh =
          tool === "SEARCH_TRAINS" &&
          !dateChanged &&
          !routeChanged &&
          !!ref.journeyDate &&
          ref.journeyDate === old.journeyDate &&
          !!ref.route?.from &&
          ref.route.from === old.route?.from &&
          (ref.route.to ?? "") === (old.route?.to ?? "");
        if (dateChanged || routeChanged || sameJourneyRefresh) {
          old.supersededBy = refId;
          old.supersededReason = dateChanged
            ? "journey date changed"
            : routeChanged
              ? "route changed"
              : "newer search for the same route/date";
          // Prompt 25 §7: a changed journey invalidates selection + form state.
          if (conv.selection) {
            conv.selection = undefined;
            conv.passengers = [];
          }
        }
      }
    }

    // Journey context bookkeeping (deterministic, from validated args only).
    if (tool === "SEARCH_TRAINS") {
      if (a.from) conv.journey.from = a.from;
      if (a.to) conv.journey.to = a.to;
      if (a.date) conv.journey.date = a.date;
    } else if (tool === "CHECK_AVAILABILITY" || tool === "GET_FARE") {
      if (a.trainNumber) conv.journey.trainNumber = a.trainNumber;
      if (a.date) conv.journey.date = a.date;
      if (a.classCode) conv.journey.classCode = a.classCode;
    } else if (tool === "TRACK_TRAIN" || tool === "GET_TIMETABLE" || tool === "GET_TRAIN_INFO") {
      if (a.trainNumber) conv.journey.trainNumber = a.trainNumber;
      if (a.date) conv.journey.date = a.date;
    }

    // Prompt 31/32: new search/availability/fare DATA can change booking-critical
    // facts — any existing review is invalidated (confirmation must not carry
    // over). A FAILED lookup (error/timeout/unavailable/not_configured) returns
    // no data and changes no facts, so it must not invalidate the review.
    if (
      (result.status === "ok" || result.status === "stale") &&
      (tool === "SEARCH_TRAINS" || tool === "CHECK_AVAILABILITY" || tool === "GET_FARE")
    ) {
      conv.review = undefined;
    }

    conv.results.push(ref);
    if (conv.results.length > MAX_RESULT_REFS) {
      conv.results.splice(0, conv.results.length - MAX_RESULT_REFS);
    }
    conv.updatedAt = new Date().toISOString();
    return ref;
  }

  /** The compact context block the LLM sees every turn (bounded size). */
  buildContextBlock(conv: Conversation, turnId: string, todayIso: string): string {
    const j = conv.journey;
    const journey = [
      j.from || j.to ? `route: ${j.from ?? "?"} → ${j.to ?? "?"}` : null,
      j.date ? `journey date: ${j.date}` : null,
      j.trainNumber ? `selected train: ${j.trainNumber}${j.trainName ? ` (${j.trainName})` : ""}` : null,
      j.classCode ? `class: ${j.classCode}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    const results = conv.results
      .map((r) => {
        const parts = [
          `[${r.refId}] ${r.tool}`,
          r.route?.from ? `${r.route.from}→${r.route.to ?? "?"}` : null,
          r.journeyDate ? `date=${r.journeyDate}` : null,
          r.classCode ? `class=${r.classCode}` : null,
          `status=${r.status}`,
          r.freshness ? `freshness=${r.freshness}` : null,
          r.retrievedAt ? `retrievedAt=${r.retrievedAt}` : null,
          r.supersededBy ? `SUPERSEDED by ${r.supersededBy} (${r.supersededReason})` : null,
        ]
          .filter(Boolean)
          .join(" ");
        const shown = (r.items ?? []).slice(0, MAX_CONTEXT_ITEMS);
        const extra = (r.items?.length ?? 0) - shown.length;
        const items = shown.length
          ? `\n     items: ${shown.map((i) => `${i.index}) ${i.label}`).join("; ")}${
              extra > 0 ? ` (+${extra} more in current results — selectable, not listed)` : ""
            }`
          : "";
        return `  ${parts}${items}`;
      })
      .join("\n");

    // Prompt 25: authoritative selection + passenger-form state (facts only).
    const sel = conv.selection;
    const selectionLine = sel
      ? `train ${sel.trainNumber}${sel.trainName ? ` (${sel.trainName})` : ""}${sel.from ? ` ${sel.from}→${sel.to ?? "?"}` : ""}${sel.journeyDate ? ` date=${sel.journeyDate}` : ""}${sel.classCode ? ` class=${sel.classCode}` : " class NOT selected yet"}${sel.classes?.length ? ` supported classes: ${sel.classes.join(",")}` : ""}`
      : "(no train selected)";
    const pax = conv.passengers.length
      ? conv.passengers
          .map((p, i) => {
            const missing = REQUIRED_PASSENGER_FIELDS.filter((f) => p[f] === undefined);
            return `  P${i + 1}: ${p.name ? `name=${p.name} ` : ""}${p.age !== undefined ? `age=${p.age} ` : ""}${p.gender ? `gender=${p.gender} ` : ""}${p.berth ? `berth-request=${p.berth} ` : ""}${missing.length ? `MISSING: ${missing.join(",")}` : "complete"}`;
          })
          .join("\n")
      : "  (none yet)";

    return [
      `TODAY: ${todayIso} (Asia/Kolkata) — resolve relative dates against this.`,
      `CONVERSATION: ${conv.id}  TURN: ${turnId}`,
      `JOURNEY CONTEXT: ${journey || "(nothing established yet)"}`,
      `SELECTION & PASSENGER FORM: ${selectionLine}`,
      `PASSENGERS:`,
      pax,
      `RECENT TOOL RESULTS (newest last; do not use SUPERSEDED entries as current):`,
      results || "  (none yet)",
    ].join("\n");
  }

  /* ---- Prompt 25: selection + passenger-form state (validated writes only) ---- */

  setSelection(id: string, sel: SelectionState): void {
    const conv = this.getOrCreate(id);
    conv.selection = sel;
    conv.review = undefined; // Prompt 31: booking-critical change invalidates review
    conv.updatedAt = new Date().toISOString();
  }

  setSelectionClass(id: string, classCode: string): void {
    const conv = this.get(id);
    if (conv?.selection) {
      conv.selection = { ...conv.selection, classCode };
      conv.review = undefined; // Prompt 31: booking-critical change invalidates review
      conv.updatedAt = new Date().toISOString();
    }
  }

  clearSelection(id: string): void {
    const conv = this.get(id);
    if (!conv) return;
    conv.selection = undefined;
    conv.passengers = [];
    conv.review = undefined;
    conv.updatedAt = new Date().toISOString();
  }

  updatePassenger(
    id: string,
    index: number,
    patch: PassengerDraft,
  ): { ok: true; passengers: PassengerDraft[] } | { ok: false; error: string } {
    const conv = this.getOrCreate(id);
    if (!conv.selection?.classCode) return { ok: false, error: "No valid train+class selected yet." };
    if (!Number.isInteger(index) || index < 1 || index > MAX_PASSENGERS) {
      return { ok: false, error: `Passenger index must be 1..${MAX_PASSENGERS}.` };
    }
    if (index > conv.passengers.length + 1) {
      return { ok: false, error: "Complete the current passenger before adding another." };
    }
    const last = conv.passengers[conv.passengers.length - 1];
    if (index === conv.passengers.length + 1 && last && !REQUIRED_PASSENGER_FIELDS.every((f) => last[f] !== undefined)) {
      return { ok: false, error: "Complete the current passenger before adding another." };
    }
    while (conv.passengers.length < index) conv.passengers.push({});
    conv.passengers[index - 1] = { ...conv.passengers[index - 1], ...patch };
    conv.review = undefined; // Prompt 31: passenger detail change invalidates review
    conv.updatedAt = new Date().toISOString();
    return { ok: true, passengers: conv.passengers };
  }

  addPassenger(id: string): { ok: true; passengers: PassengerDraft[] } | { ok: false; error: string } {
    const conv = this.getOrCreate(id);
    if (!conv.selection?.classCode) return { ok: false, error: "No valid train+class selected yet." };
    if (conv.passengers.length >= MAX_PASSENGERS) return { ok: false, error: `Maximum ${MAX_PASSENGERS} passengers.` };
    const last = conv.passengers[conv.passengers.length - 1];
    if (last && !REQUIRED_PASSENGER_FIELDS.every((f) => last[f] !== undefined)) {
      return { ok: false, error: "Complete the current passenger before adding another." };
    }
    conv.passengers.push({});
    conv.review = undefined; // Prompt 31: passenger count change invalidates review
    conv.updatedAt = new Date().toISOString();
    return { ok: true, passengers: conv.passengers };
  }

  /* ---- Prompt 31: deterministic review build + confirmation boundary ---- */

  /** Deterministic snapshot of everything booking-critical. */
  reviewSnapshot(conv: Conversation): string {
    const latest = (tool: string) => {
      const refs = conv.results.filter((r) => r.tool === tool && !r.supersededBy);
      const r = refs[refs.length - 1];
      return r ? `${r.refId}@${r.retrievedAt ?? ""}` : null;
    };
    return JSON.stringify({
      journey: conv.journey,
      selection: conv.selection ?? null,
      passengers: conv.passengers,
      availability: latest("CHECK_AVAILABILITY"),
      fare: latest("GET_FARE"),
    });
  }

  /** Builds a review ONLY when the preparation service says ready. */
  buildReview(id: string): { ok: true; review: ReviewState } | { ok: false; error: string } {
    const conv = this.get(id);
    if (!conv) return { ok: false, error: "Unknown conversation." };
    const readiness = evaluateReadiness(conv);
    if (!readiness.ready) {
      return {
        ok: false,
        error: `Not ready for review: ${readiness.missingFields.length ? `missing ${readiness.missingFields.join(", ")}` : readiness.blockers.map((b) => b.code).join(", ")}`,
      };
    }
    const review: ReviewState = {
      version: (conv.review?.version ?? 0) + 1,
      builtAt: new Date().toISOString(),
      status: "awaiting_confirmation",
      snapshot: this.reviewSnapshot(conv),
    };
    conv.review = review;
    conv.updatedAt = new Date().toISOString();
    return { ok: true, review };
  }

  /** Confirmation is valid only for the current, awaiting, un-staled review. */
  confirmReview(id: string): { ok: true; review: ReviewState } | { ok: false; error: string } {
    const conv = this.get(id);
    const review = conv?.review;
    if (!conv || !review) return { ok: false, error: "No review is pending — build the review first." };
    if (review.status !== "awaiting_confirmation") {
      return { ok: false, error: "This review was already confirmed; rebuild it to confirm again." };
    }
    if (this.reviewSnapshot(conv) !== review.snapshot) {
      conv.review = undefined; // details changed under the review — invalidate
      conv.updatedAt = new Date().toISOString();
      return { ok: false, error: "Details changed after the review was built — review invalidated. Rebuild and review the updated details." };
    }
    review.status = "confirmed";
    conv.updatedAt = new Date().toISOString();
    return { ok: true, review };
  }

  private prune(conv: Conversation): void {
    if (conv.messages.length > MAX_MESSAGES) {
      conv.messages.splice(0, conv.messages.length - MAX_MESSAGES);
    }
  }

  private evict(): void {
    const now = Date.now();
    for (const [id, conv] of this.conversations) {
      if (now - new Date(conv.updatedAt).getTime() > TTL_MS) this.conversations.delete(id);
    }
    while (this.conversations.size > MAX_CONVERSATIONS) {
      const oldest = this.conversations.keys().next().value;
      if (oldest === undefined) break;
      this.conversations.delete(oldest);
    }
  }
}

function compactItems(data: unknown): { index: number; label: string }[] | undefined {
  if (!Array.isArray(data)) return undefined;
  return data.map((row, i) => {
    const r = row as Record<string, unknown>;
    const label =
      [r.trainNumber, r.trainName, r.departure && `dep ${String(r.departure)}`, r.arrival && `arr ${String(r.arrival)}`]
        .filter(Boolean)
        .join(" ") || JSON.stringify(row).slice(0, 80);
    const classes = Array.isArray(r.classes)
      ? (r.classes as unknown[]).filter((c): c is string => typeof c === "string").slice(0, 8)
      : undefined;
    return { index: i + 1, label, ...(classes?.length ? { classes } : {}) };
  });
}

/** Only real provider data shaped by the domain schemas — never invented. */
function compactFare(data: unknown): { classCode: string; totalFare: number; currency: string } | undefined {
  const d = data as { classCode?: unknown; totalFare?: unknown; currency?: unknown } | null;
  if (!d || typeof d !== "object") return undefined;
  if (typeof d.classCode !== "string" || typeof d.totalFare !== "number") return undefined;
  return { classCode: d.classCode, totalFare: d.totalFare, currency: typeof d.currency === "string" ? d.currency : "INR" };
}

function compactAvailability(data: unknown): { classCode: string; status: string }[] | undefined {
  const d = data as { classes?: unknown } | null;
  if (!d || !Array.isArray(d.classes)) return undefined;
  const rows = d.classes
    .filter((c): c is { classCode?: unknown; status?: unknown } => typeof c === "object" && c !== null)
    .filter((c) => typeof c.classCode === "string" && typeof c.status === "string")
    .map((c) => ({ classCode: c.classCode as string, status: c.status as string }));
  return rows.length ? rows.slice(0, 8) : undefined;
}

function compactSummary(result: ToolResult): string {
  if (result.status === "not_configured") return "no authorized live provider configured";
  if (result.status === "ok" && Array.isArray(result.data)) return `${(result.data as unknown[]).length} rows`;
  return result.status;
}

/** Singleton used by the API route; tests construct their own instances. */
export const conversationStore = new ConversationStore();
