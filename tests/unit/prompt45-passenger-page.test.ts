import { describe, expect, it } from "vitest";
import { ConversationStore, requiredFieldsFor } from "@/assistant/context/store";
import { evaluateReadiness } from "@/assistant/booking/preparation";
import { validateCategory, validateNationality } from "@/assistant/passengers/validate";
import { guardSaveClaims } from "@/assistant/passengers/save-claim-guard";

/**
 * Prompt 45 — IRCTC-style passenger page: under-5 children rule, passenger
 * categories, and the save-claim guard fix for "नोट कर ली गई है" claims.
 *
 * Children rule (fetched from the official IRCTC fare policy): children under
 * 5 travel free with no ticket when no separate berth is requested; full
 * adult fare if a berth is requested. 5–11: half fare no berth / full with
 * berth. 12+ are adults.
 */

describe("passenger categories + IRCTC under-5 rule", () => {
  it("infant without berth does NOT require a berth; every other passenger still needs all fields", () => {
    expect(requiredFieldsFor({ category: "infant_without_berth" })).toEqual(["name", "age", "gender"]);
    expect(requiredFieldsFor({ category: "infant_with_berth" })).toContain("berth");
    expect(requiredFieldsFor({})).toContain("berth");
  });

  it("readiness: infant_without_berth without berth is complete; no false PASSENGER_INCOMPLETE", () => {
    const store = new ConversationStore();
    const conv = store.getOrCreate("p45-infant");
    conv.selection = {
      trainNumber: "12951", trainName: "X", from: "NDLS", to: "BCT",
      journeyDate: "2026-11-02", classCode: "3A", selectedAt: new Date().toISOString(),
    };
    store.addPassenger("p45-infant", "infant_without_berth");
    store.updatePassenger("p45-infant", 1, { name: "Aarav", age: 2, gender: "male" });
    const r = evaluateReadiness(store.get("p45-infant")!);
    expect(r.blockers.map((b) => b.code)).not.toContain("PASSENGER_INCOMPLETE");
    expect(r.ready).toBe(true);
  });

  it("readiness: infant entries must be UNDER 5 — age 6 infant is a hard blocker (official rule)", () => {
    const store = new ConversationStore();
    const conv = store.getOrCreate("p45-age");
    conv.selection = {
      trainNumber: "12951", trainName: "X", from: "NDLS", to: "BCT",
      journeyDate: "2026-11-02", classCode: "3A", selectedAt: new Date().toISOString(),
    };
    store.addPassenger("p45-age", "infant_without_berth");
    expect(store.updatePassenger("p45-age", 1, { name: "Veer", age: 6, gender: "male" }).ok).toBe(false);
    // Defensive readiness also rejects invalid persisted snapshots.
    store.getOrCreate("p45-age").passengers[0] = { category: "infant_without_berth", age: 6, name: "Veer", gender: "male" };
    const r = evaluateReadiness(store.get("p45-age")!);
    expect(r.blockers.map((b) => b.code)).toContain("INFANT_AGE_INVALID");
    expect(r.ready).toBe(false);
  });

  it("readiness: under-5 entered as a normal passenger raises the free-travel rule warning", () => {
    const store = new ConversationStore();
    const conv = store.getOrCreate("p45-warn");
    conv.selection = {
      trainNumber: "12951", trainName: "X", from: "NDLS", to: "BCT",
      journeyDate: "2026-11-02", classCode: "3A", selectedAt: new Date().toISOString(),
    };
    store.addPassenger("p45-warn");
    store.updatePassenger("p45-warn", 1, { name: "Diya", age: 3, gender: "female", berth: "Lower Berth" });
    const r = evaluateReadiness(store.get("p45-warn")!);
    expect(r.warnings.map((w) => w.code)).toContain("CHILD_UNDER_5_RULE");
  });

  it("5–11 passenger raises the half-fare rule warning; 12+ raises nothing extra", () => {
    const store = new ConversationStore();
    const conv = store.getOrCreate("p45-child");
    conv.selection = {
      trainNumber: "12951", trainName: "X", from: "NDLS", to: "BCT",
      journeyDate: "2026-11-02", classCode: "3A", selectedAt: new Date().toISOString(),
    };
    store.addPassenger("p45-child");
    store.updatePassenger("p45-child", 1, { name: "Kabir", age: 8, gender: "male", berth: "Lower Berth" });
    expect(evaluateReadiness(store.get("p45-child")!).warnings.map((w) => w.code)).toContain("CHILD_5_11_FARE_RULE");
    store.updatePassenger("p45-child", 1, { age: 30 });
    expect(evaluateReadiness(store.get("p45-child")!).warnings.map((w) => w.code)).not.toContain("CHILD_5_11_FARE_RULE");
  });

  it("addPassenger stamps the category and India nationality", () => {
    const store = new ConversationStore();
    const conv = store.getOrCreate("p45-add");
    conv.selection = {
      trainNumber: "12951", trainName: "X", from: "NDLS", to: "BCT",
      journeyDate: "2026-11-02", classCode: "3A", selectedAt: new Date().toISOString(),
    };
    store.updatePassenger("p45-add", 1, { name: "Rahul", age: 30, gender: "male", berth: "Lower" });
    const r = store.addPassenger("p45-add", "infant_without_berth");
    expect(r.ok).toBe(true);
    const p = store.get("p45-add")!.passengers[1];
    expect(p.category).toBe("infant_without_berth");
    expect(p.nationality).toBe("India");
  });
});

describe("category/nationality validation", () => {
  it("accepts only the three IRCTC-style categories", () => {
    expect(validateCategory("infant_without_berth").ok).toBe(true);
    expect(validateCategory("infant_with_berth").ok).toBe(true);
    expect(validateCategory("passenger").ok).toBe(true);
    expect(validateCategory("infant").ok).toBe(false);
    expect(validateCategory("").ok).toBe(false);
    expect(validateCategory("constructor").ok).toBe(false);
    expect(validateCategory("__proto__").ok).toBe(false);
  });
  it("nationality 3-40 chars", () => {
    expect(validateNationality("India").ok).toBe(true);
    expect(validateNationality("In").ok).toBe(false);
    expect(validateNationality("x".repeat(41)).ok).toBe(false);
  });
});

describe("Prompt 45 save-claim guard — 'नोट कर ली गई है' claims are caught", () => {
  it("blocks the exact production bug sentence: बर्थ प्रेफरेंस 'लोअर बर्थ' नोट कर ली गई है", () => {
    // The user's bug: AI claimed the berth preference was noted while the
    // form's berth field was still empty → must be blocked + recovery-eligible.
    const res = guardSaveClaims({
      text: "बर्थ प्रेफरेंस 'लोअर बर्थ' नोट कर ली गई है। आपकी यात्रा की पूरी जानकारी तैयार है।",
      turnResults: [],
      passengers: [{ name: "Mohit", age: 30, gender: "male" }], // berth missing
    });
    expect(res.adjusted).toBe(true);
    expect(res.blockedClaims.map((b) => b.field)).toContain("berth");
    expect(res.text).not.toMatch(/नोट कर ली गई है/);
  });

  it("'noted'/'note kar liya' English-Hinglish variants are also claims", () => {
    for (const t of [
      "Gender male noted.",
      "Aapka naam Rahul note kar liya gaya hai.",
      "Age 30 note ho gayi hai.",
    ]) {
      const res = guardSaveClaims({ text: t, turnResults: [], passengers: [{}] });
      expect(res.adjusted, t).toBe(true);
    }
  });

  it("a TRUTHFUL 'noted' claim backed by authoritative state passes untouched", () => {
    const res = guardSaveClaims({
      text: "बर्थ प्रेफरेंस 'लोअर बर्थ' नोट कर ली गई है।",
      turnResults: [],
      passengers: [{ name: "Mohit", age: 30, gender: "male", berth: "लोअर बर्थ" }],
    });
    expect(res.adjusted).toBe(false);
  });
});

describe("infant boundaries and review integrity", () => {
  function seed(id: string) {
    const store = new ConversationStore();
    store.getOrCreate(id).selection = { trainNumber: "12951", trainName: "X", from: "LDH", to: "NDLS", journeyDate: "2026-11-02", classCode: "3A", selectedAt: new Date().toISOString() };
    return store;
  }
  it("0 and 4 are under five; 5 and older are not; malformed ages never truncate", async () => {
    const { validateAge } = await import("@/assistant/passengers/validate");
    for (const age of [0, 4, "0", "4"]) expect(validateAge(age).ok).toBe(true);
    for (const age of [true, null, "", "2years", "2.5", -1, 121]) expect(validateAge(age).ok).toBe(false);
    for (const age of [5, 6, 12]) {
      const store = seed(`boundary-${age}`);
      expect(store.updatePassenger(`boundary-${age}`, 1, { category: "infant_without_berth", age }).ok).toBe(false);
    }
  });
  it("explicit no-berth category clears an old preference and invalidates review; with-berth requires a fresh preference", () => {
    const s = seed("category-switch");
    s.updatePassenger("category-switch", 1, { name: "Aarav", age: 2, gender: "male", berth: "Lower" });
    expect(s.buildReview("category-switch").ok).toBe(true);
    expect(s.updatePassenger("category-switch", 1, { category: "infant_without_berth" }).ok).toBe(true);
    expect(s.get("category-switch")?.passengers[0].berth).toBeUndefined();
    expect(s.get("category-switch")?.review).toBeUndefined();
    expect(s.buildReview("category-switch").ok).toBe(true);
    expect(s.updatePassenger("category-switch", 1, { berth: "Lower" }).ok).toBe(false);
    s.updatePassenger("category-switch", 1, { category: "infant_with_berth" });
    expect(s.buildReview("category-switch").ok).toBe(false);
  });
  it("complete no-berth infant permits next entry; existing six-entry product limit stays enforced", () => {
    const s = seed("entry-limit");
    for (let i = 1; i <= 6; i++) {
      expect(s.updatePassenger("entry-limit", i, { name: "Child", age: 2, gender: "male", category: "infant_without_berth" }).ok).toBe(true);
    }
    expect(s.addPassenger("entry-limit").ok).toBe(false);
    expect(s.updatePassenger("entry-limit", 7, { name: "Extra" }).ok).toBe(false);
  });
});
