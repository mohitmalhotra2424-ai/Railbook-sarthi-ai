import type { PassengerDraft } from "@/assistant/context/store";

/**
 * Prompt 25 — passenger field validation boundary.
 * The LLM (or the manual form, or a voice transcript via the chat turn) may
 * PROPOSE values; nothing becomes authoritative until it passes these
 * validators. No invented defaults, no silent coercion of uncertain input.
 */

export type FieldCheck<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateName(raw: unknown): FieldCheck<string> {
  if (typeof raw !== "string") return { ok: false, error: "Naam text mein bataiye." };
  const v = raw.trim().replace(/\s+/g, " ");
  if (v.length < 3 || v.length > 60) return { ok: false, error: "Name must be 3-60 characters." };
  if (!/^[\p{L}][\p{L}\p{M}.' -]*$/u.test(v)) {
    return { ok: false, error: "Name contains unsupported characters — please re-type it." };
  }
  return { ok: true, value: v };
}

export function validateAge(raw: unknown): FieldCheck<number> {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > 120) {
    return { ok: false, error: "Age must be a whole number between 1 and 120." };
  }
  return { ok: true, value: n };
}

const GENDERS: Record<string, "male" | "female" | "other"> = {
  male: "male",
  m: "male",
  female: "female",
  f: "female",
  other: "other",
  o: "other",
};
export function validateGender(raw: unknown): FieldCheck<"male" | "female" | "other"> {
  const g = GENDERS[String(raw ?? "").trim().toLowerCase()];
  if (!g) return { ok: false, error: "Gender must be male, female or other." };
  return { ok: true, value: g };
}

/** Berth preference is a REQUEST only — no authorised provider verifies options. */
export function validateBerth(raw: unknown): FieldCheck<string> {
  const v = String(raw ?? "").trim();
  if (!v || v.length > 40) return { ok: false, error: "Berth preference not understood." };
  return { ok: true, value: v };
}

export const FOOD_UNSUPPORTED_ERROR =
  "Food preference is not supported by any authorised integration in this product, so the field is omitted. Nothing was invented.";

/** One validated entry point used by chat tools AND the manual form endpoint. */
export function validatePassengerField(
  field: string,
  value: unknown,
): { ok: true; patch: PassengerDraft } | { ok: false; error: string } {
  switch (field) {
    case "name": {
      const r = validateName(value);
      return r.ok ? { ok: true, patch: { name: r.value } } : r;
    }
    case "age": {
      const r = validateAge(value);
      return r.ok ? { ok: true, patch: { age: r.value } } : r;
    }
    case "gender": {
      const r = validateGender(value);
      return r.ok ? { ok: true, patch: { gender: r.value } } : r;
    }
    case "berth": {
      const r = validateBerth(value);
      return r.ok ? { ok: true, patch: { berth: r.value } } : r;
    }
    case "food":
      return { ok: false, error: FOOD_UNSUPPORTED_ERROR };
    default:
      return { ok: false, error: `Unknown passenger field "${field}".` };
  }
}
