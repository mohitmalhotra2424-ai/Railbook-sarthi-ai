/**
 * Server-side TTS synthesis (Prompt 34 addendum) — OpenAI-compatible
 * /audio/speech contract, verified against the configured endpoint
 * (models list + auth behaviour). Speaks ONLY the text handed in (the
 * existing assistant response, cleaned client-side); never generates a
 * new answer. Credentials stay on the server; failures are honest and
 * the client falls back to browser speechSynthesis.
 */
import { readTtsConfig } from "./tts-config";

export type TtsFailureCode = "not_configured" | "auth" | "timeout" | "http" | "invalid_audio";
export type TtsResult =
  | { ok: true; audio: Buffer; contentType: string }
  | { ok: false; code: TtsFailureCode; error: string };

const DEFAULT_TIMEOUT_MS = 20_000;

export async function synthesizeSpeech(text: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<TtsResult> {
  const cfg = readTtsConfig();
  if (!cfg) return { ok: false, code: "not_configured", error: "Server TTS is not configured." };
  const input = text.trim();
  if (!input) return { ok: false, code: "invalid_audio", error: "Nothing to speak." };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.model, voice: cfg.voice, input }),
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, code: "auth", error: "TTS endpoint rejected the configured credentials." };
    }
    if (!res.ok) {
      return { ok: false, code: "http", error: `TTS endpoint answered HTTP ${res.status}.` };
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("audio/")) {
      return { ok: false, code: "invalid_audio", error: `TTS endpoint returned non-audio (${contentType || "unknown type"}).` };
    }
    const audio = Buffer.from(await res.arrayBuffer());
    if (audio.length === 0) {
      return { ok: false, code: "invalid_audio", error: "TTS endpoint returned empty audio." };
    }
    return { ok: true, audio, contentType };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, code: "timeout", error: "TTS request timed out." };
    }
    return { ok: false, code: "http", error: "TTS endpoint unreachable." };
  } finally {
    clearTimeout(timer);
  }
}
