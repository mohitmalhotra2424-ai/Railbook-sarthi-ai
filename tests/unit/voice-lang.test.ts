import { describe, expect, it } from "vitest";
import { detectTtsLanguage, speakableText } from "@/components/voice/lang";

describe("voice language + speakable-text helpers (pure functions)", () => {
  it("picks the Hindi voice when Devanagari is present, else English", () => {
    expect(detectTtsLanguage("नमस्ते, आपकी ट्रेन समय पर है")).toBe("hi-IN");
    expect(detectTtsLanguage("Your train is on time")).toBe("en-IN");
    // Hinglish with any Devanagari still gets the Hindi voice
    expect(detectTtsLanguage("ट्रेन 12014 on time hai")).toBe("hi-IN");
    expect(detectTtsLanguage("")).toBe("en-IN");
  });

  it("strips markdown noise so raw markup is never read aloud", () => {
    const raw =
      "Ye rahi trains:\n * **12014** — ASR SHTBDI · dep `04:55`\n * 12904 — GOLDEN TEMPLE\n> note";
    const clean = speakableText(raw);
    expect(clean).not.toContain("*");
    expect(clean).not.toContain("`");
    expect(clean).not.toContain(">");
    expect(clean).toContain("12014");
    expect(clean).toContain("04:55");
    expect(clean).not.toMatch(/\s{2,}/);
  });

  it("drops fenced code blocks entirely", () => {
    expect(speakableText("Answer:\n```json\n{\"a\":1}\n```\ndone")).toBe("Answer: done");
  });
});
