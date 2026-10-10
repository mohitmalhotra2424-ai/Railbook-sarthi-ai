import type { Locale } from "@/lib/i18n";

export type IntentType =
  | "search"
  | "pnr"
  | "liveStatus"
  | "fare"
  | "availability"
  | "timetable"
  | "cancellations"
  | "greeting"
  | "unknown";

export interface Intent {
  type: IntentType;
  locale: Locale;
  entities: { pnr?: string; raw: string };
}

const RX = {
  pnrKeyword: /\bpnr\b|पीएनआर|पी\s?एन\s?आर/i,
  pnrNumber: /\b\d{10}\b/,
  live: /live status|running|delay|delayed|late\b|kitne baje|kitna late|kahan pahunch|कहाँ पहुँच|कहां पहुँच|where is (my |the )?train|current status/i,
  fare: /\bfare\b|kiraya|किराया|ticket price|कीमत/i,
  availability: /\bseat\b|\bberth\b|availability|उपलब्ध|खाली/i,
  timetable: /timetable|time\s?table|schedule|timing|समय|टाइम\s?टेबल/i,
  cancellations: /cancel|cancell?ed|cancellation|रद्द|divert/i,
  // NOTE: \b word boundaries do NOT work around Devanagari script — Hindi
  // alternatives are matched without them (separate alternation branch).
  greeting: /^\s*(hi|hii+|hello|hey|namaste|namaskar|salaam|sat sri akal)\b|^\s*(नमस्ते|नमस्कार|हैलो)/i,
  train: /\btrains?\b|\bticket\b|ट्रेन|गाड़ी|रेलगाड़ी/i,
};

const HINGLISH_MARKERS =
  /\b(kitne|kitna|kitni|kahan|kab|batao|bataiye|nahi|nahin|kya|hai|hain|chahiye|karo|karoo|kaun|konsa|kaunsa|mujhe|mera|meri|tum|aap|bhai|yaar)\b/i;

const DEVANAGARI = /[\u0900-\u097F]/;

export function detectLocale(text: string): Locale {
  if (DEVANAGARI.test(text)) return "hi";
  if (HINGLISH_MARKERS.test(text)) return "hinglish";
  return "en";
}

/**
 * Deterministic, rule-based intent routing for hi/hinglish/en.
 * Priority order matters: a 10-digit PNR wins over every other keyword.
 */
export function detectIntent(text: string): Intent {
  const locale = detectLocale(text);
  const entities: Intent["entities"] = { raw: text };

  const pnrMatch = text.match(RX.pnrNumber);
  if (RX.pnrKeyword.test(text)) {
    // PNR keyword wins even without a number — the assistant then asks for
    // the 10-digit PNR instead of guessing or mis-routing the intent.
    if (pnrMatch) entities.pnr = pnrMatch[0];
    return { type: "pnr", locale, entities };
  }
  if (RX.live.test(text)) return { type: "liveStatus", locale, entities };
  if (RX.cancellations.test(text)) return { type: "cancellations", locale, entities };
  if (RX.fare.test(text)) return { type: "fare", locale, entities };
  if (RX.availability.test(text)) return { type: "availability", locale, entities };
  if (RX.timetable.test(text)) return { type: "timetable", locale, entities };
  if (RX.greeting.test(text)) return { type: "greeting", locale, entities };
  if (RX.train.test(text)) return { type: "search", locale, entities };
  return { type: "unknown", locale, entities };
}

/** The capability a data intent maps to, if any. */
export const INTENT_TO_CAPABILITY: Partial<
  Record<IntentType, "trainSearch" | "liveStatus" | "fare" | "seatAvailability" | "timetable" | "pnr" | "cancellations">
> = {
  search: "trainSearch",
  liveStatus: "liveStatus",
  fare: "fare",
  availability: "seatAvailability",
  timetable: "timetable",
  pnr: "pnr",
  cancellations: "cancellations",
};
