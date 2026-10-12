import type { ToolResult } from "@/assistant/tools/results";

/**
 * Prompt 41 — availability/filter claim-safety guard.
 *
 * Narrow, post-response consistency check in the exact spirit of the Prompt
 * 26 save-claim guard: regexes only LOCATE candidate claim sentences in the
 * assistant's final text; every verdict is decided by THIS turn's structured
 * tool outcomes (FILTER_TRAINS.availabilityFilter counts, CHECK_AVAILABILITY
 * ok results, failed filter operations) — never by keyword-matching results
 * and never by the model's own earlier words.
 *
 * Core rule: a "seats confirmed / available / filtered" claim is permitted
 * only when a successful availability operation in this turn supports that
 * exact claim (right class, non-zero confirmed count, and — for "all/every"
 * wording — complete verification). A "no train is available" claim is
 * permitted only after a COMPLETE verified negative. Everything else —
 * failed filters, raw fallback searches, stale evidence from earlier turns
 * (not present in turnResults by construction), class mismatches — is
 * replaced with an honest, language-matched disclosure.
 *
 * The guard never executes tools, never mutates stored state, never weakens
 * a truthful reply, and passes ordinary conversation through untouched.
 */

export interface AvailabilityClaimGuardInput {
  /** The assistant's final text for this turn (after any save-claim guard). */
  text: string;
  /** Structured results of THIS turn only (fresh, current-session). */
  turnResults: ToolResult[];
}

export interface BlockedAvailabilityClaim {
  sentence: string;
  /** Structured reason — from operation outcomes, not from wording. */
  reason:
    | "filter_failed_raw_results"
    | "no_availability_evidence"
    | "class_mismatch"
    | "incomplete_verification"
    | "nothing_confirmed"
    | "unverified_no_availability_claim";
}

export interface AvailabilityClaimGuardResult {
  text: string;
  adjusted: boolean;
  blockedClaims: BlockedAvailabilityClaim[];
}

type Verdict = { supported: true } | { supported: false; reason: BlockedAvailabilityClaim["reason"] };

const DEVANAGARI = /[\u0900-\u097f]/;
const CLASS_CODES = /\b(1A|2A|3A|3E|3AC|SL|CC|2S|EC|VV|FC|GN)\b/;

/** Explicit success wording: seats confirmed/available (EN/Hinglish/Hindi). */
const CONFIRM_PHRASE =
  /(confirm(?:ed| ho|e)?\b|कन्फर्म|कंफ़र्म|कंफर्म|\bavailable\b|\bउपलब्ध\b|सीटें? (मिल|उपलब्ध)|seats? (mil|book)|बुक हो सकती)/i;
/** Universal quantifier — turns the claim into "ALL results satisfy it". */
const UNIVERSAL = /\b(all|every|sabhi|sab|har|poori|pura|sare)\b|सभी|हर एक/i;
/** Verified-negative wording: "no train is available / koi train nahi". */
const UNIVERSAL_NEGATIVE =
  /(koi (bhi )?(train|seat)s?[^.!?\n]{0,40}(nahi|nahī|नहीं)|कोई (ट्रेन|सीट)[^.!?\n]{0,40}नहीं|\bno (trains?|seats?)[^.!?\n]{0,40}(available|confirmed)|\bnone[^.!?\n]{0,40}(available|confirmed)|\bnot (a single|any) (train|seat))/i;
/** Negation attached to an availability word ("seats confirmed nahi hain" — an honest non-claim). */
const NEGATION = /(nahi|nahī|नहीं|\bnot\b|\bno\b|\bnever\b)/i;

/** Split into sentences keeping delimiters (same approach as the save guard). */
function splitSentences(text: string): string[] {
  const parts = text.split(/([.!?।\n]+)/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const s = `${parts[i] ?? ""}${parts[i + 1] ?? ""}`;
    if (s.trim()) out.push(s);
  }
  return out;
}

interface Evidence {
  /** Latest successful availability-filter outcome this turn (structured counts). */
  avFilter?: ToolResult["availabilityFilter"];
  /** A FILTER_TRAINS operation failed this turn. */
  filterFailed: boolean;
  /** Raw search results were fetched successfully this turn. */
  rawSearch: boolean;
  /** Classes with a successful per-train CHECK_AVAILABILITY this turn. */
  checkedClasses: Set<string>;
}

function deriveEvidence(turnResults: ToolResult[]): Evidence {
  const ev: Evidence = { filterFailed: false, rawSearch: false, checkedClasses: new Set() };
  for (const r of turnResults) {
    if (r.tool === "FILTER_TRAINS") {
      if (r.status === "ok" && r.availabilityFilter) ev.avFilter = r.availabilityFilter;
      if (r.status !== "ok") ev.filterFailed = true;
    }
    if (r.tool === "SEARCH_TRAINS" && (r.status === "ok" || r.status === "stale")) ev.rawSearch = true;
    if (r.tool === "CHECK_AVAILABILITY" && r.status === "ok" && r.classCode) {
      ev.checkedClasses.add(r.classCode.toUpperCase());
    }
  }
  return ev;
}

function judgeConfirmClaim(sentence: string, ev: Evidence): Verdict {
  const claimedClass = sentence.match(CLASS_CODES)?.[1]?.toUpperCase();
  const universal = UNIVERSAL.test(sentence);
  const f = ev.avFilter;

  if (f) {
    if (claimedClass && claimedClass !== f.classCode && claimedClass !== "3AC") {
      return { supported: false, reason: "class_mismatch" };
    }
    if (f.available === 0) return { supported: false, reason: "nothing_confirmed" };
    if (universal && !f.complete) return { supported: false, reason: "incomplete_verification" };
    return { supported: true };
  }
  if (claimedClass && ev.checkedClasses.has(claimedClass)) {
    // A per-train live check for that class succeeded this turn.
    if (universal) return { supported: false, reason: "incomplete_verification" };
    return { supported: true };
  }
  if (ev.filterFailed && ev.rawSearch) return { supported: false, reason: "filter_failed_raw_results" };
  return { supported: false, reason: "no_availability_evidence" };
}

function judgeUniversalNegativeClaim(ev: Evidence): Verdict {
  const f = ev.avFilter;
  if (f && f.available === 0 && f.complete) return { supported: true }; // fully verified negative
  if (f && f.available === 0 && !f.complete) return { supported: false, reason: "unverified_no_availability_claim" };
  if (ev.filterFailed || !f) return { supported: false, reason: "unverified_no_availability_claim" };
  return { supported: false, reason: "unverified_no_availability_claim" };
}

function fallbackFor(reason: BlockedAvailabilityClaim["reason"], sentence: string, cls?: string): string {
  const hi = DEVANAGARI.test(sentence);
  const c = cls ? ` ${cls}` : "";
  switch (reason) {
    case "filter_failed_raw_results":
      return hi
        ? `Availability filter${c} complete nahi ho paaya. Neeche current search results hain — sabhi trains ki seats confirmed nahi hain.`
        : `The${c} availability filter did not complete. Below are the current raw search results — seats on these trains are NOT confirmed.`;
    case "class_mismatch":
      return hi
        ? `Is baari${c} ke liye koi confirmed availability result nahi hai — jo results dikhe hain wo doosri class ke hain.`
        : `There is no confirmed${c} availability result this turn — the results shown are for a different class.`;
    case "incomplete_verification":
      return hi
        ? `Sabhi trains verify nahi ho paaye — sirf jin trains ki availability confirm hui hai wahi confirmed hain.`
        : `Not every train could be verified — only the trains whose availability was explicitly confirmed are confirmed.`;
    case "nothing_confirmed":
      return hi
        ? `Jo trains check ho paayi, unme se kisimein${c} confirmed seats nahi hain${cls ? "" : ""}.`
        : `None of the checked trains has confirmed${c} seats.`;
    case "unverified_no_availability_claim":
      return hi
        ? `Availability poori tarah verify nahi ho paayi — isliye "koi train available nahi hai" nahi kaha ja sakta.`
        : `Availability could not be fully verified — so it cannot be said that no train is available.`;
    default:
      return hi
        ? `Abhi koi confirmed availability jaankari nahi hai — ye bina verify kiye gaye results hain.`
        : `There is no confirmed availability information this turn — these results are unverified.`;
  }
}

/** The guard entry point. Pure: same input → same output, no side effects. */
export function guardAvailabilityClaims(input: AvailabilityClaimGuardInput): AvailabilityClaimGuardResult {
  const ev = deriveEvidence(input.turnResults);
  const sentences = splitSentences(input.text);
  const blockedClaims: BlockedAvailabilityClaim[] = [];
  const out: string[] = [];
  const usedFallbacks = new Set<string>();

  for (const sentence of sentences) {
    const cls = sentence.match(CLASS_CODES)?.[1]?.toUpperCase();

    // 1) "No train is available" as a VERIFIED FACT — needs a complete negative.
    if (UNIVERSAL_NEGATIVE.test(sentence)) {
      const verdict = judgeUniversalNegativeClaim(ev);
      if (verdict.supported) {
        out.push(sentence);
        continue;
      }
      blockedClaims.push({ sentence, reason: verdict.reason });
      const fb = fallbackFor(verdict.reason, sentence, cls);
      if (!usedFallbacks.has(fb)) {
        usedFallbacks.add(fb);
        out.push(` ${fb} `);
      }
      continue;
    }

    // 2) Positive "seats confirmed/available" claim (honest negations like
    //    "seats confirmed nahi hain" are NOT claims and pass through).
    const isConfirm = CONFIRM_PHRASE.test(sentence) && !NEGATION.test(sentence);
    if (!isConfirm) {
      out.push(sentence);
      continue;
    }
    const verdict = judgeConfirmClaim(sentence, ev);
    if (verdict.supported) {
      out.push(sentence);
      continue;
    }
    blockedClaims.push({ sentence, reason: verdict.reason });
    const fb = fallbackFor(verdict.reason, sentence, cls);
    if (!usedFallbacks.has(fb)) {
      usedFallbacks.add(fb);
      out.push(` ${fb} `);
    }
  }

  if (blockedClaims.length === 0) return { text: input.text, adjusted: false, blockedClaims };
  const text = out.join("").replace(/\s{2,}/g, " ").trim();
  return { text, adjusted: true, blockedClaims };
}
