import type { PassengerDraft } from "@/assistant/context/store";
import type { ToolResult } from "@/assistant/tools/results";

/**
 * Prompt 26 — verified save-claim guard.
 *
 * Narrow, post-response consistency check: it inspects the assistant's
 * final text AFTER the LLM produced it and BEFORE it is delivered, and
 * refuses to let a passenger-field "saved/updated/confirmed" claim reach
 * the user unless authoritative application evidence supports it.
 *
 * Evidence sources (existing, authoritative — nothing is invented):
 *  1. THIS turn's structured tool results (UPDATE_PASSENGER, status "ok",
 *     whose data carries the post-update passenger array).
 *  2. The CURRENT session's authoritative passenger-form state.
 *
 * The guard never executes tools, retries operations, changes tool
 * arguments, or mutates stored state. When a claim is unsupported it
 * replaces ONLY the unsupported sentence with an honest, language-matched
 * fallback; ordinary conversation passes through untouched.
 *
 * Session/staleness scoping: callers pass only the current turn's results
 * and the current conversation's state, so evidence from another session,
 * another turn, or a superseded state cannot authorize a claim.
 */

export type ClaimField = "name" | "age" | "gender" | "berth" | "details";

export interface SaveClaimGuardInput {
  /** The assistant's final text for this turn. */
  text: string;
  /** Structured results of THIS turn only (fresh, current-session). */
  turnResults: ToolResult[];
  /** Authoritative passenger drafts of the CURRENT conversation. */
  passengers: PassengerDraft[];
}

export interface BlockedClaim {
  field: ClaimField;
  /** The original sentence that contained the unsupported claim. */
  sentence: string;
}

export interface SaveClaimGuardResult {
  text: string;
  adjusted: boolean;
  blockedClaims: BlockedClaim[];
}

const FIELD_PATTERNS: { field: ClaimField; re: RegExp }[] = [
  { field: "age", re: /\b(age|umar|age)\b|उम्र|आयु/i },
  { field: "name", re: /\b(name|naam)\b|नाम/i },
  { field: "gender", re: /\b(gender|sex)\b|लिंग/i },
  { field: "berth", re: /\b(berth)\b|बर्थ/i },
  { field: "details", re: /\b(details?|info(rmation)?)\b|जानकारी|विवरण/i },
];

/** Any "save/update/confirm/record/store" verb, English or Hindi/Hinglish. */
const SAVE_VERB =
  /(save|saved|सेव|सहेज|update|updated|अपडेट|confirm|confirmed|कन्फर्म|कन्फ़र्म|confirm|record|recorded|दर्ज|store|stored)/i;

/** Completion markers that turn the verb into a "it IS saved" claim. */
const COMPLETION =
  /(ho\s*(gaya|gayi|gaye|chuka|chuki|chuke|liya|li|gae|gayee)|हो\s*(गया|गई|गये|चुका|चुकी|लिया)|की\s*(गई|गया)|ली\s*(गई)|गई\s*है|गया\s*है|\bis\s+(saved|updated|confirmed|recorded|stored)\b|\bhas\s+been\b|\bsaved\b|\bupdated\b|\bconfirmed\b|\brecorded\b|\bstored\b)/i;

const DEVANAGARI = /[\u0900-\u097f]/;

function detectField(sentence: string): ClaimField | null {
  for (const { field, re } of FIELD_PATTERNS) {
    if (re.test(sentence)) return field;
  }
  return null;
}

/** Split into sentences while keeping delimiters attached. */
function splitSentences(text: string): string[] {
  const parts = text.split(/([.!?।\n]+)/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const s = `${parts[i] ?? ""}${parts[i + 1] ?? ""}`;
    if (s.trim()) out.push(s);
  }
  return out;
}

interface Claim {
  field: ClaimField;
  sentence: string;
  /** Numeric value explicitly mentioned (age claims). */
  claimedAge: number | null;
}

function extractClaim(sentence: string, field: ClaimField): Claim {
  const digits = sentence.match(/\b(\d{1,3})\b/);
  const claimedAge = field === "age" && digits ? Number(digits[1]) : null;
  return { field, sentence, claimedAge };
}

/** Capitalized name-like phrases in a sentence, minus common words. */
const NAME_STOPWORDS = new Set([
  "age", "name", "naam", "save", "saved", "update", "updated", "confirm", "confirmed",
  "record", "recorded", "store", "stored", "ho", "gaya", "gayi", "gaye", "hai", "the",
  "has", "been", "is", "form", "please", "check", "passenger", "passengers", "berth",
  "gender", "details", "detail", "info", "abhi", "kar", "liya", "chuka", "chuki",
]);
function extractNameMentions(sentence: string): string[] {
  const phrases = sentence.match(/\b[A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,})*\b/g) ?? [];
  return phrases.filter((p) => !NAME_STOPWORDS.has(p.split(" ")[0].toLowerCase()));
}

/** Does one authoritative draft support the claim (field + value match)? */
function stateSupports(p: PassengerDraft, claim: Claim): boolean {
  const v = p[claim.field === "details" ? "name" : claim.field];
  if (claim.field === "details") {
    // Generic claim: supported when the form has at least one saved value.
    return p.name !== undefined || p.age !== undefined || p.gender !== undefined;
  }
  if (v === undefined) return false;
  if (claim.field === "age") {
    // A concrete claimed value must match exactly (value-mismatch → block).
    return claim.claimedAge === null || v === claim.claimedAge;
  }
  return true; // name / gender / berth present in authoritative state
}

/**
 * Evidence rule (existing semantics only — conditions 1–5 of Prompt 26):
 *  - Core: the CURRENT session's authoritative state must contain the
 *    claimed field/value. A previously VALIDATED update recorded there is
 *    itself authoritative success evidence, so a truthful confirmation is
 *    NOT blocked just because this turn has no tool result (Test G).
 *  - A matching UPDATE_PASSENGER result with status "ok" in THIS turn is
 *    the fresh-evidence path (Test B). Results from failed operations,
 *    other fields/passengers/values, other turns or other sessions never
 *    authorize a claim: they are either non-"ok" or simply not passed in,
 *    and the state check still has to hold (Tests C–F).
 *  - A specific name mentioned in the claim must match the authoritative
 *    name; mismatches are blocked (Test E).
 */
function claimSupported(claim: Claim, input: SaveClaimGuardInput): boolean {
  const stateOk = input.passengers.some((p) => stateSupports(p, claim));
  if (!stateOk) return false;

  if (claim.field === "name" || claim.field === "details") {
    const mentions = extractNameMentions(claim.sentence);
    const names = input.passengers
      .map((p) => p.name)
      .filter((n): n is string => typeof n === "string");
    const mentionsKnownName = mentions.some((m) =>
      names.some(
        (n) => n.toLowerCase().includes(m.toLowerCase()) || m.toLowerCase().includes(n.toLowerCase()),
      ),
    );
    if (mentions.length > 0 && !mentionsKnownName) return false; // name mismatch
  }

  return true;
}

function fallbackFor(claim: Claim): string {
  const hindi = DEVANAGARI.test(claim.sentence);
  const labelHi: Record<ClaimField, string> = {
    age: "उम्र",
    name: "नाम",
    gender: "लिंग",
    berth: "बर्थ",
    details: "जानकारी",
  };
  const labelEn: Record<ClaimField, string> = {
    age: "Age",
    name: "Naam",
    gender: "Gender",
    berth: "Berth",
    details: "Details",
  };
  return hindi
    ? `${labelHi[claim.field]} अभी save confirm नहीं हुई। कृपया form में check कर लें।`
    : `${labelEn[claim.field]} abhi save confirm nahi hui. Please form mein check kar lein.`;
}

/**
 * The guard entry point. Pure: same input → same output, no side effects.
 */
export function guardSaveClaims(input: SaveClaimGuardInput): SaveClaimGuardResult {
  const sentences = splitSentences(input.text);
  const blockedClaims: BlockedClaim[] = [];
  const out: string[] = [];
  const usedFallbacks = new Set<string>();

  for (const sentence of sentences) {
    const isClaim = SAVE_VERB.test(sentence) && COMPLETION.test(sentence);
    const field = isClaim ? detectField(sentence) : null;
    if (!isClaim || field === null) {
      out.push(sentence); // ordinary conversation — untouched
      continue;
    }
    const claim = extractClaim(sentence, field);
    if (claimSupported(claim, input)) {
      out.push(sentence); // evidence-backed confirmation — permitted
      continue;
    }
    const fb = fallbackFor(claim);
    blockedClaims.push({ field, sentence });
    if (!usedFallbacks.has(fb)) {
      usedFallbacks.add(fb);
      out.push(` ${fb} `);
    }
  }

  if (blockedClaims.length === 0) return { text: input.text, adjusted: false, blockedClaims };
  const text = out.join("").replace(/\s{2,}/g, " ").trim();
  return { text, adjusted: true, blockedClaims };
}
