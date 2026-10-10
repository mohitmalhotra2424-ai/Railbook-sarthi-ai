/**
 * UI + assistant strings for the three supported locales.
 * Adding a string requires all three locales (typed) — no silent gaps.
 */

export type Locale = "hi" | "hinglish" | "en";

export const SUPPORTED_LOCALES: readonly Locale[] = ["hi", "hinglish", "en"] as const;

export function parseLocale(value: string | null | undefined): Locale {
  return value === "hi" || value === "hinglish" || value === "en" ? value : "en";
}

type StringId =
  | "notConfiguredBanner"
  | "notConfiguredDetail"
  | "sourceLabel"
  | "retrievedLabel"
  | "freshness.fresh"
  | "freshness.stale"
  | "freshness.unknown"
  | "bookingDisabled"
  | "uncertaintyNotice";

export const strings: Record<StringId, Record<Locale, string>> = {
  notConfiguredBanner: {
    en: "Live data provider not configured.",
    hi: "लाइव डेटा प्रोवाइडर कॉन्फ़िगर नहीं है।",
    hinglish: "Live data provider configure nahi hai.",
  },
  notConfiguredDetail: {
    en: "RailSaarthi never guesses train numbers, fares, availability, PNR status or timings. Results appear only from authorized data providers.",
    hi: "रेलसारथी कभी ट्रेन नंबर, किराया, सीट उपलब्धता, PNR स्थिति या समय अनुमान से नहीं बताता। परिणाम केवल अधिकृत डेटा प्रोवाइडर से ही आते हैं।",
    hinglish: "RailSaarthi kabhi train number, fare, seat availability, PNR status ya timing guess nahi karta. Results sirf authorized data providers se aate hain.",
  },
  sourceLabel: {
    en: "Source",
    hi: "स्रोत",
    hinglish: "Source",
  },
  retrievedLabel: {
    en: "Retrieved",
    hi: "प्राप्ति समय",
    hinglish: "Retrieved",
  },
  "freshness.fresh": {
    en: "fresh",
    hi: "ताज़ा",
    hinglish: "fresh",
  },
  "freshness.stale": {
    en: "stale",
    hi: "पुराना",
    hinglish: "stale",
  },
  "freshness.unknown": {
    en: "unknown freshness",
    hi: "ताज़गी अज्ञात",
    hinglish: "freshness unknown",
  },
  bookingDisabled: {
    en: "Booking, payment and ticket issuance are disabled until an authorized booking integration is supplied.",
    hi: "बुकिंग, भुगतान और टिकट जारी करना तब तक अक्षम हैं जब तक कोई अधिकृत बुकिंग इंटीग्रेशन नहीं मिल जाता।",
    hinglish: "Booking, payment aur ticket issuance tab tak disabled hain jab tak koi authorized booking integration nahi milta.",
  },
  uncertaintyNotice: {
    en: "Sources disagree on this value. Both are shown; nothing was averaged or resolved automatically.",
    hi: "इस मान पर स्रोत असहमत हैं। दोनों दिखाए गए हैं; कुछ भी औसत या स्वतः हल नहीं किया गया।",
    hinglish: "Is value par sources disagree kar rahe hain. Dono dikhaye gaye hain; kuch bhi average ya auto-resolve nahi kiya gaya.",
  },
};

export function tr(id: StringId, locale: Locale): string {
  return strings[id][locale] ?? strings[id].en;
}
