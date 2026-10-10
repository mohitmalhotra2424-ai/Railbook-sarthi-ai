import { describe, expect, it } from "vitest";
import { detectIntent, detectLocale } from "@/assistant/intents";

describe("detectLocale", () => {
  it("detects Devanagari script as hi", () => {
    expect(detectLocale("दिल्ली से मुंबई ट्रेन")).toBe("hi");
  });
  it("detects romanized Hindi as hinglish", () => {
    expect(detectLocale("Mumbai se Delhi train kitne baje chalegi")).toBe("hinglish");
  });
  it("defaults to en", () => {
    expect(detectLocale("trains from Delhi to Mumbai")).toBe("en");
  });
});

describe("detectIntent", () => {
  it("extracts a 10-digit PNR and locale", () => {
    const i = detectIntent("PNR 1234567890 ka status batao");
    expect(i.type).toBe("pnr");
    expect(i.entities.pnr).toBe("1234567890");
    expect(i.locale).toBe("hinglish");
  });

  it("handles Hindi PNR requests", () => {
    const i = detectIntent("पीएनआर 9876543210 की स्थिति बताओ");
    expect(i.type).toBe("pnr");
    expect(i.entities.pnr).toBe("9876543210");
    expect(i.locale).toBe("hi");
  });

  it("does not treat a 5-digit train number as a PNR", () => {
    const i = detectIntent("PNR of train 12951");
    expect(i.entities.pnr).toBeUndefined();
  });

  it("recognizes live status in english and hinglish", () => {
    expect(detectIntent("where is train 12951 running").type).toBe("liveStatus");
    expect(detectIntent("12951 kitne baje aayegi").type).toBe("liveStatus");
  });

  it("recognizes cancellations", () => {
    expect(detectIntent("aaj cancelled trains ki list").type).toBe("cancellations");
    expect(detectIntent("आज रद्द ट्रेनें").type).toBe("cancellations");
  });

  it("recognizes fare", () => {
    expect(detectIntent("12951 me 3A ka kiraya kitna hai").type).toBe("fare");
  });

  it("recognizes seat availability", () => {
    expect(detectIntent("seat availability for 12951").type).toBe("availability");
  });

  it("recognizes timetable", () => {
    expect(detectIntent("12951 ka timetable dikhao").type).toBe("timetable");
  });

  it("recognizes greetings", () => {
    expect(detectIntent("नमस्ते").type).toBe("greeting");
    expect(detectIntent("hello!").type).toBe("greeting");
  });

  it("maps generic train questions to search", () => {
    expect(detectIntent("trains from Delhi to Mumbai tomorrow").type).toBe("search");
    expect(detectIntent("दिल्ली से मुंबई ट्रेन").type).toBe("search");
  });

  it("falls back to unknown", () => {
    expect(detectIntent("weather kaisa hai").type).toBe("unknown");
  });
});
