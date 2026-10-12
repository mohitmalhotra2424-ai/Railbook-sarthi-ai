import { badRequest, jsonResponse } from "@/lib/http";
import { readTtsConfig } from "@/assistant/voice/tts-config";
import { synthesizeSpeech } from "@/assistant/voice/tts";

export const dynamic = "force-dynamic";

/**
 * POST /api/voice/speech — server-side TTS (Prompt 34 addendum).
 * Body: { text } (the exact assistant response the client wants spoken).
 * Returns raw playable audio on success. The VOICE_TTS_* credentials are
 * read server-side only and are NEVER included in any response, log or
 * client bundle. Honest failures: 503 not configured, 502 upstream error —
 * the client then falls back to browser speechSynthesis.
 */
/** Safe capability probe for the UI (no credential, no audio). */
export async function GET(): Promise<Response> {
  return jsonResponse({ configured: readTtsConfig() !== null });
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.slice(0, 1500) : "";
  if (!text.trim()) return badRequest("text is required.");

  const result = await synthesizeSpeech(text);
  if (!result.ok) {
    return jsonResponse({ ok: false, code: result.code, error: result.error }, { status: result.code === "not_configured" ? 503 : 502 });
  }
  return new Response(new Uint8Array(result.audio), {
    headers: { "content-type": result.contentType, "cache-control": "no-store" },
  });
}
