/**
 * Server-side TTS configuration (Prompt 34 addendum). Read ONLY from
 * server-side environment variables — never bundled, never sent to clients,
 * never logged. When anything is missing the server TTS path is honestly
 * "not configured" and the client keeps its browser-speechSynthesis fallback.
 */
export interface TtsConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
}

export function readTtsConfig(env: NodeJS.ProcessEnv = process.env): TtsConfig | null {
  const provider = (env.VOICE_TTS_PROVIDER ?? "").trim();
  const baseUrl = (env.VOICE_TTS_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const apiKey = (env.VOICE_TTS_API_KEY ?? "").trim();
  const model = (env.VOICE_TTS_MODEL ?? "").trim();
  const voice = (env.VOICE_TTS_VOICE ?? "").trim();
  if (provider !== "openai" || !baseUrl || !apiKey || !model || !voice) return null;
  return { provider, baseUrl, apiKey, model, voice };
}
