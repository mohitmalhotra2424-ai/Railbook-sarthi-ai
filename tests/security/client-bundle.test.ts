import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Requirement 8 enforcement: after `npm run build`, no client-side JS may
 * contain secret values, secret-shaped tokens, or server env var names.
 * Skips (loudly, in CI order) until a production build exists.
 */

const STATIC_DIR = join(process.cwd(), ".next", "static");
const hasBuild = existsSync(STATIC_DIR);

const FORBIDDEN: { pattern: RegExp; label: string }[] = [
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{8,}/, label: "anthropic-style key" },
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}/, label: "openai-style key" },
  { pattern: /\bAIza[0-9A-Za-z_-]{16,}/, label: "google-style key" },
  { pattern: /OPENAI_API_KEY/, label: "OPENAI_API_KEY reference" },
  { pattern: /ANTHROPIC_API_KEY/, label: "ANTHROPIC_API_KEY reference" },
  { pattern: /GEMINI_API_KEY/, label: "GEMINI_API_KEY reference" },
  { pattern: /RAILWAY_PROVIDER_[A-Z0-9_]*_KEY/, label: "railway credential reference" },
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith(".js")) yield full;
  }
}

describe.skipIf(!hasBuild)("client bundle secret scan", () => {
  it("contains no credential values or server env names", () => {
    const offenders: string[] = [];
    for (const file of walk(STATIC_DIR)) {
      const content = readFileSync(file, "utf8");
      for (const { pattern, label } of FORBIDDEN) {
        if (pattern.test(content)) offenders.push(`${file}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("client bundle scan — availability guard", () => {
  it(hasBuild ? "found .next/static (scan active)" : "SKIPPED: run `npm run build` first to activate the scan", () => {
    expect(true).toBe(true);
  });
});
