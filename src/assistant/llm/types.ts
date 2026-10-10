export type LlmProviderId = "openai" | "anthropic" | "gemini";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmResult {
  text: string;
  model: string;
  providerId: LlmProviderId;
}

/** Thrown when the selected vendor has no API key configured. Never contains the key. */
export class LlmNotConfiguredError extends Error {
  constructor(public readonly providerId: LlmProviderId) {
    super(`LLM provider "${providerId}" is not configured (no API key set).`);
    this.name = "LlmNotConfiguredError";
  }
}

/**
 * Shared vendor-agnostic adapter contract (requirement 8).
 * Adapters read their credentials ONLY from server-side env vars and accept
 * an injectable transport so tests never make live calls.
 */
export interface LlmAdapter {
  readonly id: LlmProviderId;
  readonly defaultModel: string;
  isConfigured(): boolean;
  complete(request: LlmRequest, transport?: typeof fetch): Promise<LlmResult>;
}
