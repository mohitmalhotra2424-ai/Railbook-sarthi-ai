/**
 * Pure helpers for the voice layer (no browser APIs here — unit-testable).
 */

/** Devanagari present → Hindi voice; otherwise English (India). */
export function detectTtsLanguage(text: string): "hi-IN" | "en-IN" {
  return /[\u0900-\u097F]/.test(text) ? "hi-IN" : "en-IN";
}

/**
 * Convert an assistant reply into plain speakable text: no markdown
 * bullets/asterisks/hashes/backticks, no raw JSON-ish noise, collapsed
 * whitespace. We only ever speak the ACTUAL assistant response.
 */
export function speakableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks (never read aloud)
    .replace(/[*_#`>~]/g, " ") // markdown emphasis/bullets/quotes
    .replace(/\s+/g, " ")
    .trim();
}
