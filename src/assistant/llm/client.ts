import { logger } from "@/lib/logger";
import { anthropicAdapter } from "./adapters/anthropic";
import { geminiAdapter } from "./adapters/gemini";
import { openaiAdapter } from "./adapters/openai";
import type { LlmAdapter, LlmProviderId, LlmRequest, LlmResult } from "./types";

const ADAPTERS: Record<LlmProviderId, LlmAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
};

/** Selected provider id, or null when unset/disabled/invalid. */
export function selectedLlmProviderId(): LlmProviderId | null {
  const raw = (process.env.LLM_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "openai" || raw === "anthropic" || raw === "gemini") return raw;
  return null;
}

/** The selected adapter IF it has credentials; otherwise null (graceful). */
export function getLlmAdapter(): LlmAdapter | null {
  const id = selectedLlmProviderId();
  if (!id) return null;
  const adapter = ADAPTERS[id];
  return adapter.isConfigured() ? adapter : null;
}

/**
 * Complete via the configured LLM, or return null when unconfigured/failed.
 * Callers MUST have a deterministic fallback — the assistant never depends
 * on an LLM to stay honest.
 */
export async function completeWithLlm(request: LlmRequest): Promise<LlmResult | null> {
  const adapter = getLlmAdapter();
  if (!adapter) return null;
  try {
    return await adapter.complete(request);
  } catch (error) {
    logger.error("LLM call failed", {
      provider: adapter.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
