/**
 * PROMPT 35 — natural conversational voice layer (pure-function units).
 * Covers: speakable-text artifact cleaning without fact loss, language
 * detection for Devanagari / Hinglish / English (mid-conversation switching
 * is per-utterance detection), sentence chunking for natural fallback
 * playback, and the speech summary built ONLY from verified structured
 * data (no invented availability/fare/status).
 */
import { describe, expect, it } from "vitest";
import { detectTtsLanguage, speakableText, spokenSentences } from "@/components/voice/lang";
import { speechSummary } from "@/components/voice/speechSummary";
import type { ResultBlock, TrainCard } from "@/assistant/orchestrator";

describe("speakableText — presentation artifacts stripped, facts preserved (P35)", () => {
  it("reads link labels, never URLs", () => {
    const clean = speakableText("Details [PNR status](https://example.com/pnr/123) dekhein.");
    expect(clean).toContain("PNR status");
    expect(clean).not.toContain("https://");
    expect(clean).not.toContain("](");
  });

  it("speaks arrows as a natural pause word, not a glyph", () => {
    expect(speakableText("Amritsar → Delhi")).toBe("Amritsar se Delhi");
    expect(speakableText("Amritsar -> Delhi")).toBe("Amritsar se Delhi");
  });

  it("speaks the rupee symbol as a word and keeps the number", () => {
    const clean = speakableText("Fare ₹1,234 hai.");
    expect(clean).not.toContain("₹");
    expect(clean).toContain("rupees");
    expect(clean).toContain("1,234");
  });

  it("turns bullets into commas instead of dropping or glyphing", () => {
    const clean = speakableText("• 12014 Shatabdi\n· 12904 Golden Temple");
    expect(clean).not.toMatch(/[•·]/);
    expect(clean).toContain("12014");
    expect(clean).toContain("12904");
  });

  it("preserves all verified facts through cleaning", () => {
    const raw =
      "**12014** ASR SHTBDI departs `04:55` NDLS 09:55 · fare ₹1,070 · [more](https://x.test) → done";
    const clean = speakableText(raw);
    for (const fact of ["12014", "ASR SHTBDI", "04:55", "09:55", "NDLS", "1,070", "more", "done"]) {
      expect(clean).toContain(fact);
    }
    expect(clean).not.toMatch(/[*_#>`•·₹→]/);
    expect(clean).not.toContain("https://");
  });
});

describe("detectTtsLanguage — per-utterance detection supports switching", () => {
  it("Devanagari, Hinglish and English all map correctly", () => {
    expect(detectTtsLanguage("मुझे कल दिल्ली जाना है")).toBe("hi-IN"); // Hindi Devanagari
    expect(detectTtsLanguage("Mujhe kal Delhi jaana hai")).toBe("en-IN"); // Hinglish (Latin)
    expect(detectTtsLanguage("What is the fare for 3AC?")).toBe("en-IN"); // English
    expect(detectTtsLanguage("ट्रेन 12014 ka fare kya hai")).toBe("hi-IN"); // mixed → Hindi voice
  });
});

describe("spokenSentences — natural segmentation for fallback playback", () => {
  it("splits on sentence boundaries in order", () => {
    const text = "Aaj 3 trains hain. Shatabdi sabse tez hai. Fare 1070 rupees hai.";
    // small maxLen forces boundary splits; short text stays one chunk by default
    const chunks = spokenSentences(text, 30);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toContain("Aaj 3 trains");
    expect(chunks[2]).toContain("1070 rupees");
    expect(spokenSentences(text)).toHaveLength(1); // merged under default maxLen
  });

  it("hard-splits an oversized single sentence instead of stalling", () => {
    const long = "Haan. " + "yeh ek bahut lamba vakya hai. ".repeat(30).replace(/\./g, ",");
    const chunks = spokenSentences(long, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(60);
  });

  it("never loses content across chunks", () => {
    const text = "12014 Shatabdi chalti hai. 12904 bhi available hai.";
    expect(spokenSentences(text).join("")).toContain("12014");
    expect(spokenSentences(text).join("")).toContain("12904");
  });

  it("handles empty and whitespace-only input", () => {
    expect(spokenSentences("")).toEqual([]);
    expect(spokenSentences("   \n ")).toEqual([]);
  });
});

describe("speechSummary — spoken ONLY from verified structured data", () => {
  const card: TrainCard = {
    trainNumber: "12014",
    trainName: "ASR SHTBDI",
    from: "Amritsar",
    to: "New Delhi",
    departure: "04:55",
    arrival: "09:55",
    availability: [
      { classCode: "CC", status: "AVAILABLE-12" },
      { classCode: "EC", status: "RAC 5" },
      { classCode: "3A", status: "WL 29" },
      { classCode: "SL", status: "REGRET" },
      { classCode: "2S", status: "OPEN-55" },
    ],
  };

  it("speaks honest category labels for card availability, exact statuses not invented", () => {
    const s = speechSummary({ cards: [card] });
    expect(s).toContain("12014");
    expect(s).toContain("CC Available");
    expect(s).toContain("EC RAC");
    expect(s).toContain("3A Waitlist");
    expect(s).toContain("SL Not available");
    expect(s).toContain("2S As reported"); // unknown pattern → honest label, never "confirmed"
  });

  it("says honestly when availability was not published instead of inventing it", () => {
    const s = speechSummary({ cards: [{ ...card, availability: undefined }] });
    expect(s).toContain("abhi availability verify nahi hui");
  });

  it("speaks fare from the verified block only", () => {
    const block = {
      kind: "fare",
      data: { trainNumber: "12014", classCode: "CC", from: "ASR", to: "NDLS", baseFare: 900, totalFare: 1070, currency: "INR" },
    } as unknown as ResultBlock;
    const s = speechSummary({ blocks: [block] });
    expect(s).toContain("12014");
    expect(s).toContain("1070 rupees");
    expect(s).not.toMatch(/\b(900)\b/); // base fare not spoken as total
  });

  it("speaks live status truthfully, including unknown", () => {
    const running = {
      kind: "live",
      data: { trainNumber: "12014", trainName: "ASR SHTBDI", running: true, lastStation: { code: "UMB", name: "Ambala" }, delayMinutes: 0, updatedAt: null },
    } as unknown as ResultBlock;
    const unknown = {
      kind: "live",
      data: { trainNumber: "12014", trainName: "ASR SHTBDI", running: null, lastStation: null, delayMinutes: null, updatedAt: null },
    } as unknown as ResultBlock;
    expect(speechSummary({ blocks: [running] })).toContain("running hai");
    expect(speechSummary({ blocks: [running] })).toContain("Ambala");
    expect(speechSummary({ blocks: [unknown] })).toContain("verify nahi hui");
  });

  it("includes the assistant text verbatim (no rewriting, no second LLM polish)", () => {
    const text = "Aapke liye 3 trains mili hain.";
    expect(speechSummary({ text })).toBe(text);
  });
});
