/**
 * Prompt 31 — BookingPreparationService.
 *
 * Deterministic evaluation of booking-preparation readiness. The LLM remains
 * the conversational decision-maker; it is NEVER the authority that declares
 * booking readiness. This service only READS authoritative session state
 * (selection, passengers, recorded tool results) and returns a structured
 * result: ready / missingFields / blockers / warnings.
 *
 * It does not book, submit, pay or issue tickets — it only evaluates whether
 * the preparation requirements are met so the review/confirmation boundary
 * (store.buildReview / store.confirmReview) can be offered safely.
 */

import {
  REQUIRED_PASSENGER_FIELDS,
  type Conversation,
} from "@/assistant/context/store";

/** Terminal preparation state — preparation met + review confirmed. NOT a booking. */
export const IRCTC_HANDOFF_READY = "IRCTC_HANDOFF_READY" as const;

export type BlockerCode =
  | "NO_TRAIN_SELECTED"
  | "NO_CLASS_SELECTED"
  | "CLASS_NOT_OFFERED"
  | "NO_JOURNEY_DATE"
  | "NO_PASSENGERS"
  | "PASSENGER_INCOMPLETE"
  | "STALE_AVAILABILITY"
  | "STALE_FARE";

export type WarningCode =
  | "AVAILABILITY_NOT_VERIFIED"
  | "FARE_NOT_VERIFIED"
  | "BERTH_IS_REQUEST_ONLY";

export interface ReadinessIssue {
  code: BlockerCode | WarningCode | string;
  detail: string;
}

export interface ReadinessResult {
  ready: boolean;
  /** Human-readable missing items, e.g. "passenger 1: berth". */
  missingFields: string[];
  blockers: ReadinessIssue[];
  warnings: ReadinessIssue[];
}

type ReadinessInput = Pick<Conversation, "selection" | "passengers" | "results">;

function latestMatch(
  conv: ReadinessInput,
  tool: string,
  match: (r: { classCode?: string }) => boolean,
) {
  const refs = conv.results.filter((r) => r.tool === tool && match(r));
  return refs.length ? refs[refs.length - 1] : undefined;
}

function isStale(ref: { supersededBy?: string; freshness?: string } | undefined): boolean {
  if (!ref) return false;
  return Boolean(ref.supersededBy) || ref.freshness === "stale";
}

/**
 * Pure, deterministic readiness evaluation over authoritative state only.
 * No provider calls, no LLM input, no invented defaults.
 */
export function evaluateReadiness(conv: ReadinessInput): ReadinessResult {
  const missingFields: string[] = [];
  const blockers: ReadinessIssue[] = [];
  const warnings: ReadinessIssue[] = [];
  const sel = conv.selection;

  // Journey completeness: selected train + date.
  if (!sel) {
    blockers.push({ code: "NO_TRAIN_SELECTED", detail: "No train selected yet." });
  } else {
    if (!sel.journeyDate) {
      missingFields.push("journey date");
      blockers.push({ code: "NO_JOURNEY_DATE", detail: "Journey date is not set for the selected train." });
    }
    if (!sel.classCode) {
      missingFields.push("class");
      blockers.push({ code: "NO_CLASS_SELECTED", detail: "No class selected for this train yet." });
    } else if (sel.classes?.length && !sel.classes.includes(sel.classCode)) {
      blockers.push({
        code: "CLASS_NOT_OFFERED",
        detail: `Class ${sel.classCode} is not among the provider-returned classes (${sel.classes.join(", ")}).`,
      });
    }
  }

  // Passenger count + per-passenger completeness (every form field is mandatory).
  if (conv.passengers.length === 0) {
    missingFields.push("passenger details");
    blockers.push({ code: "NO_PASSENGERS", detail: "No passenger details collected yet." });
  }
  conv.passengers.forEach((p, i) => {
    const missing = REQUIRED_PASSENGER_FIELDS.filter((f) => p[f] === undefined);
    for (const f of missing) missingFields.push(`passenger ${i + 1}: ${f}`);
    if (missing.length) {
      blockers.push({
        code: "PASSENGER_INCOMPLETE",
        detail: `Passenger ${i + 1} is missing: ${missing.join(", ")}.`,
      });
    }
    if (p.berth) {
      warnings.push({
        code: "BERTH_IS_REQUEST_ONLY",
        detail: `Passenger ${i + 1} berth "${p.berth}" is a request only — no authorised provider verifies it.`,
      });
    }
  });

  // Required current railway data: a recorded availability/fare result for the
  // selected train must not be stale or superseded; absence is a warning only
  // (preparation never invents availability or fare facts).
  if (sel) {
    const avail = latestMatch(conv, "CHECK_AVAILABILITY", (r) => {
      if (r.classCode && sel.classCode) return r.classCode === sel.classCode;
      return true;
    });
    if (!avail) {
      warnings.push({ code: "AVAILABILITY_NOT_VERIFIED", detail: "Availability has not been checked for this selection." });
    } else if (isStale(avail)) {
      blockers.push({
        code: "STALE_AVAILABILITY",
        detail: "The recorded availability for this selection is stale or superseded — re-check it before review.",
      });
    }
    const fare = latestMatch(conv, "GET_FARE", (r) => {
      if (r.classCode && sel.classCode) return r.classCode === sel.classCode;
      return true;
    });
    if (!fare) {
      warnings.push({ code: "FARE_NOT_VERIFIED", detail: "Fare has not been checked for this selection." });
    } else if (isStale(fare)) {
      blockers.push({
        code: "STALE_FARE",
        detail: "The recorded fare for this selection is stale or superseded — re-check it before review.",
      });
    }
  }

  return {
    ready: missingFields.length === 0 && blockers.length === 0,
    missingFields,
    blockers,
    warnings,
  };
}
