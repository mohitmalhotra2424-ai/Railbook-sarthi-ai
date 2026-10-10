import { logger } from "@/lib/logger";
import type { LlmEndpointConfig } from "./config";

/**
 * OpenAI-compatible chat client with structured tool calling.
 *
 * Design rules:
 *  - credentials stay server-side; error messages never contain them
 *    (the redacting logger is the second line of defense).
 *  - malformed model output is surfaced honestly (args:null + rawArguments)
 *    so the tool layer can return a validation error the model can react to.
 *  - timeouts, rate limits and provider failures are distinct, retryable-
 *    flagged error types — never silently swallowed, never mocked around.
 */

export interface ChatToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  /** Parsed arguments, or null when the model emitted invalid JSON. */
  args: Record<string, unknown> | null;
  rawArguments?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCallRequest[];
  model: string;
  finishReason: string;
}

export class LlmNotConfiguredError extends Error {
  readonly code = "LLM_NOT_CONFIGURED" as const;
  readonly retryable = false;
  constructor() {
    super("No LLM provider is configured on the server.");
    this.name = "LlmNotConfiguredError";
  }
}

export class LlmTimeoutError extends Error {
  readonly code = "LLM_TIMEOUT" as const;
  readonly retryable = true;
  constructor(provider: string, timeoutMs: number) {
    super(`LLM request to "${provider}" timed out after ${timeoutMs}ms.`);
    this.name = "LlmTimeoutError";
  }
}

export class LlmRateLimitError extends Error {
  readonly code = "LLM_RATE_LIMITED" as const;
  readonly retryable = true;
  constructor(provider: string, retryAfter?: string) {
    super(
      `LLM provider "${provider}" rate-limited the request${retryAfter ? ` (retry after ${retryAfter}s)` : ""}.`,
    );
    this.name = "LlmRateLimitError";
  }
}

export class LlmProviderError extends Error {
  readonly code = "LLM_PROVIDER_ERROR" as const;
  readonly retryable: boolean;
  constructor(
    provider: string,
    readonly status: number,
  ) {
    // Status only — upstream bodies are never echoed (they can leak detail).
    super(`LLM provider "${provider}" returned HTTP ${status}.`);
    this.name = "LlmProviderError";
    this.retryable = status === 408 || status >= 500;
  }
}

export class LlmMalformedResponseError extends Error {
  readonly code = "LLM_MALFORMED_RESPONSE" as const;
  readonly retryable = true;
  constructor(provider: string) {
    super(`LLM provider "${provider}" returned a malformed response payload.`);
    this.name = "LlmMalformedResponseError";
  }
}

interface RawChoice {
  message?: {
    content?: string | null;
    tool_calls?: {
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }[];
  };
  finish_reason?: string;
}

export class OpenAiCompatibleClient {
  constructor(
    readonly config: LlmEndpointConfig,
    private readonly transport: typeof fetch = fetch,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const cfg = this.config;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, cfg.timeoutMs);
    const onExternalAbort = () => controller.abort();
    req.signal?.addEventListener("abort", onExternalAbort, { once: true });

    let response: Response;
    try {
      response = await this.transport(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: req.messages,
          ...(req.tools?.length ? { tools: req.tools, tool_choice: "auto" } : {}),
          temperature: req.temperature ?? 0.2,
          ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (req.signal?.aborted) throw error; // user/caller interruption — propagate as-is
      if (timedOut) throw new LlmTimeoutError(cfg.provider, cfg.timeoutMs);
      logger.warn("LLM transport error", {
        provider: cfg.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new LlmProviderError(cfg.provider, 0);
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onExternalAbort);
    }

    if (response.status === 429) {
      throw new LlmRateLimitError(cfg.provider, response.headers.get("retry-after") ?? undefined);
    }
    if (!response.ok) throw new LlmProviderError(cfg.provider, response.status);

    const json = (await response.json().catch(() => null)) as {
      choices?: RawChoice[];
      model?: string;
    } | null;
    const choice = json?.choices?.[0];
    if (!json || !choice || !choice.message) throw new LlmMalformedResponseError(cfg.provider);

    const toolCalls: ToolCallRequest[] = (choice.message.tool_calls ?? []).map((tc, i) => {
      const raw = tc.function?.arguments ?? "";
      let args: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = raw ? JSON.parse(raw) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        args = null; // surfaced below — the tool layer validates and reports
      }
      return {
        id: tc.id ?? `call-${i}`,
        name: tc.function?.name ?? "",
        args,
        ...(args === null ? { rawArguments: raw.slice(0, 500) } : {}),
      };
    });

    return {
      content: choice.message.content?.trim() ? choice.message.content : null,
      toolCalls,
      model: json.model ?? cfg.model,
      finishReason: choice.finish_reason ?? "unknown",
    };
  }
}
