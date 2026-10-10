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
  | "assistantNoProvider"
  | "assistantNoData"
  | "assistantGreeting"
  | "assistantAskPnr"
  | "assistantAskParams"
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
  assistantNoProvider: {
    en: "No authorized railway data provider is configured, so I can't fetch live results right now. I won't guess train numbers, fares, availability, PNR status or timings.",
    hi: "कोई अधिकृत रेलवे डेटा प्रोवाइडर कॉन्फ़िगर नहीं है, इसलिए मैं अभी लाइव परिणाम नहीं ला सकता। मैं ट्रेन नंबर, किराया, उपलब्धता, PNR स्थिति या समय अनुमान से नहीं बताऊँगा।",
    hinglish: "Koi authorized railway data provider configure nahi hai, isliye main abhi live results nahi la sakta. Main train number, fare, availability, PNR status ya timing guess nahi karunga.",
  },
  assistantGreeting: {
    en: "Namaste! I'm RailSaarthi, your railway assistant in Hindi, Hinglish and English. Ask me about trains, timetables, live status, fares, seat availability, PNR or cancellations.",
    hi: "नमस्ते! मैं रेलसारथी हूँ — आपका रेलवे सहायक, हिंदी, हिंग्लिश और अंग्रेज़ी में। मुझसे ट्रेनें, टाइमटेबल, लाइव स्टेटस, किराया, सीट उपलब्धता, PNR या रद्द ट्रेनों के बारे में पूछें।",
    hinglish: "Namaste! Main RailSaarthi hoon — aapka railway assistant, Hindi, Hinglish aur English mein. Mujhse trains, timetable, live status, fare, seat availability, PNR ya cancelled trains ke baare mein poochhein.",
  },
  assistantNoData: {
    en: "I couldn't retrieve a verified answer from any authorized provider just now. I won't guess train data.",
    hi: "मैं अभी किसी अधिकृत प्रोवाइडर से सत्यापित उत्तर नहीं ला सका। मैं ट्रेन डेटा अनुमान से नहीं बताऊँगा।",
    hinglish: "Main abhi kisi authorized provider se verified answer nahi la saka. Main train data guess nahi karunga.",
  },
  assistantAskPnr: {
    en: "Please share the 10-digit PNR number so I can look it up.",
    hi: "कृपया 10 अंकों का PNR नंबर भेजें ताकि मैं उसे देख सकूँ।",
    hinglish: "Please 10-digit PNR number bhejein taaki main check kar sakoon.",
  },
  assistantAskParams: {
    en: "For live status, fare, seat availability, timetable or cancellations I need exact details (train number, date, stations). Please use the Trains, PNR or Disruptions pages.",
    hi: "लाइव स्टेटस, किराया, सीट उपलब्धता, टाइमटेबल या रद्द ट्रेनों के लिए मुझे सही विवरण चाहिए (ट्रेन नंबर, तारीख़, स्टेशन)। कृपया ट्रेन, PNR या व्यवधान पेज का उपयोग करें।",
    hinglish: "Live status, fare, seat availability, timetable ya cancelled trains ke liye mujhe exact details chahiye (train number, date, stations). Please Trains, PNR ya Disruptions pages use karein.",
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
