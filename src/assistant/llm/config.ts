/**
 * LLM endpoint configuration (server-only).
 *
 * Generic, replaceable setup: any OpenAI-compatible provider is configured
 * purely through env vars — no conversation logic ever changes when the
 * provider/model changes.
 *
 *   LLM_PROVIDER / LLM_MODEL / LLM_API_KEY / LLM_BASE_URL / LLM_TIMEOUT_MS
 *   LLM_FALLBACK_PROVIDER / LLM_FALLBACK_MODEL / LLM_FALLBACK_API_KEY / LLM_FALLBACK_BASE_URL
 *
 * The fallback is used ONLY when explicitly configured, and switching to it
 * is always surfaced to the user (never silent). There is NO mock model:
 * when nothing is configured or every configured endpoint fails, the turn
 * fails honestly.
 */

export interface LlmEndpointConfig {
  /** Human label, e.g. "nvidia" — safe to display. */
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function readEndpoint(
  env: NodeJS.ProcessEnv,
  prefix: "LLM" | "LLM_FALLBACK",
): LlmEndpointConfig | null {
  const provider = (env[`${prefix}_PROVIDER`] ?? env.LLM_PROVIDER ?? "").trim();
  const model = (env[`${prefix}_MODEL`] ?? "").trim();
  const apiKey = (env[`${prefix}_API_KEY`] ?? "").trim();
  const baseUrl = (env[`${prefix}_BASE_URL`] ?? "").trim().replace(/\/$/, "");
  if (!model || !apiKey || !baseUrl) return null;
  const timeoutRaw = Number.parseInt(env.LLM_TIMEOUT_MS ?? "", 10);
  return {
    provider: provider || "openai-compatible",
    model,
    apiKey,
    baseUrl,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS,
  };
}

export interface LlmConfigs {
  primary: LlmEndpointConfig | null;
  fallback: LlmEndpointConfig | null;
}

export function readLlmConfigs(env: NodeJS.ProcessEnv = process.env): LlmConfigs {
  const primary = readEndpoint(env, "LLM");
  const fallback = readEndpoint(env, "LLM_FALLBACK");
  // A fallback identical to the primary is pointless — drop it.
  if (
    fallback &&
    primary &&
    fallback.model === primary.model &&
    fallback.apiKey === primary.apiKey &&
    fallback.baseUrl === primary.baseUrl
  ) {
    return { primary, fallback: null };
  }
  return { primary, fallback };
}

/** Metadata for /api/health — never includes the key. */
export function describeLlmConfigs(
  env: NodeJS.ProcessEnv = process.env,
): {
  primary: { provider: string; model: string; baseUrl: string; configured: boolean } | null;
  fallback: { provider: string; model: string; baseUrl: string; configured: boolean } | null;
} {
  const { primary, fallback } = readLlmConfigs(env);
  const meta = (c: LlmEndpointConfig | null) =>
    c ? { provider: c.provider, model: c.model, baseUrl: c.baseUrl, configured: true } : null;
  return { primary: meta(primary), fallback: meta(fallback) };
}
