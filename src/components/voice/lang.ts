/**
 * Pure helpers for the voice layer (no browser APIs here — unit-testable).
 * Prompt 35: natural spoken presentation of the ACTUAL assistant response —
 * facts, numbers, names, dates and statuses are never altered, only markup
 * and symbols are converted to speakable words.
 */

/** Devanagari present → Hindi voice; otherwise English (India). */
export function detectTtsLanguage(text: string): "hi-IN" | "en-IN" {
  return /[\u0900-\u097F]/.test(text) ? "hi-IN" : "en-IN";
}

/**
 * Convert an assistant reply into plain speakable text: no markdown
 * bullets/asterisks/hashes/backticks, no fenced code, links reduced to their
 * visible text, arrows/currency/bullets spoken as words, collapsed whitespace.
 * We only ever speak the ACTUAL assistant response — nothing added or removed
 * factually.
 */
export function speakableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks (never read aloud)
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, " $1 ") // [label](url) → label
    .replace(/→|->/g, " se ") // route arrows spoken naturally (before '>' strip)
    .replace(/₹/g, " rupees ")
    .replace(/[•·]/g, ", ")
    .replace(/[*_#`>~]/g, " ") // markdown emphasis/bullets/quotes
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split speakable text into sentence-sized chunks for sequential browser
 * playback (natural pauses at boundaries; avoids very long single utterances
 * that some engines truncate). Meaning and order are preserved exactly.
 */
export function spokenSentences(text: string, maxLen = 220): string[] {
  const parts = text.match(/[^。.!?\n]+[。.!?]*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    if (current && (current + " " + part).length > maxLen) {
      chunks.push(current);
      current = part;
    } else {
      current = current ? `${current} ${part}` : part;
    }
    // a single part longer than maxLen: hard-split on commas/spaces
    while (current.length > maxLen) {
      let cut = current.lastIndexOf(", ", maxLen);
      if (cut < maxLen / 2) cut = current.lastIndexOf(" ", maxLen);
      if (cut < maxLen / 2) cut = maxLen;
      chunks.push(current.slice(0, cut).trim());
      current = current.slice(cut).trim();
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}
