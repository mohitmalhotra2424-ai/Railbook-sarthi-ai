import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import { readLlmConfigs, type LlmEndpointConfig } from "./llm/config";
import {
  LlmNotConfiguredError,
  OpenAiCompatibleClient,
  type ChatMessage,
  type ChatResponse,
} from "./llm/client";
import { conversationStore, ConversationStore } from "./context/store";
import { SYSTEM_PROMPT } from "./prompts";
import { executeTool } from "./tools/executor";
import { TOOL_DEFINITIONS } from "./tools/schemas";
import type { ToolResult } from "./tools/results";
import { summarizeForUi } from "./tools/results";

/**
 * The turn orchestrator (requirement 1).
 *
 * The LLM is the sole conversational interpreter, planner and tool
 * orchestrator. This module contains NO intent detection, NO keyword
 * routing, NO scripted replies and NO mock model: it only executes the
 * model's decisions and enforces technical/safety boundaries (validation,
 * timeouts, correlation, iteration caps, honest failures, labeled fallback).
 */

export interface TrainCard {
  trainNumber: string;
  trainName: string;
  from: string;
  to: string;
  departure: string;
  arrival: string;
}

export type TurnEvent =
  | { type: "status"; text: "thinking" | "using_fallback"; model?: string }
  | { type: "tool_call"; tool: string; correlationId: string; argsSummary: string }
  | {
      type: "tool_result";
      tool: string;
      correlationId: string;
      status: ToolResult["status"];
      summary: string;
      source?: string;
      freshness?: string;
      journeyDate?: string;
      classCode?: string;
    }
  | { type: "message"; text: string; model: string; viaFallback: boolean; cards: TrainCard[] }
  | { type: "error"; code: string; message: string; retryable: boolean };

export interface RunTurnParams {
  conversationId: string;
  message: string;
  signal?: AbortSignal;
  /** Injectable for tests. */
  store?: ConversationStore;
  clientFactory?: (cfg: LlmEndpointConfig) => OpenAiCompatibleClient;
}

const MAX_TOOL_ITERATIONS = 6;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

function deriveCards(turnResults: ToolResult[]): TrainCard[] {
  const cards: TrainCard[] = [];
  for (const result of turnResults) {
    if (result.tool !== "SEARCH_TRAINS" || result.status !== "ok" || !Array.isArray(result.data)) continue;
    for (const row of result.data as Record<string, unknown>[]) {
      const from = row.from as { code?: string; name?: string } | undefined;
      const to = row.to as { code?: string; name?: string } | undefined;
      if (typeof row.trainNumber !== "string" || typeof row.trainName !== "string") continue;
      cards.push({
        trainNumber: row.trainNumber,
        trainName: row.trainName,
        from: `${from?.name ?? ""}${from?.code ? ` (${from.code})` : ""}`.trim(),
        to: `${to?.name ?? ""}${to?.code ? ` (${to.code})` : ""}`.trim(),
        departure: String(row.departure ?? ""),
        arrival: String(row.arrival ?? ""),
      });
    }
  }
  return cards;
}

export async function* runTurn(params: RunTurnParams): AsyncGenerator<TurnEvent> {
  const store = params.store ?? conversationStore;
  const turnId = `t-${randomUUID()}`;
  const conv = store.beginTurn(params.conversationId, turnId, params.message);

  const configs = readLlmConfigs();
  if (!configs.primary) {
    // Honest failure — NEVER a scripted/mock assistant (requirement 1/4).
    yield {
      type: "error",
      code: "LLM_NOT_CONFIGURED",
      message:
        "The assistant brain (LLM) is not configured on the server, so I can't answer right now. This is a configuration gap, not a railway answer.",
      retryable: false,
    };
    return;
  }

  const factory = params.clientFactory ?? ((cfg: LlmEndpointConfig) => new OpenAiCompatibleClient(cfg));
  const endpoints: { cfg: LlmEndpointConfig; viaFallback: boolean }[] = [
    { cfg: configs.primary, viaFallback: false },
    ...(configs.fallback ? [{ cfg: configs.fallback, viaFallback: true }] : []),
  ];

  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: store.buildContextBlock(conv, turnId, todayIso) },
    ...conv.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: params.message },
  ];

  const turnResults: ToolResult[] = [];
  const executedCalls = new Map<string, string>(); // tool+args → correlationId (duplicate guard)
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations += 1;
    yield { type: "status", text: "thinking" };

    // --- Call the LLM, with a LABELED fallback (never silent, never mock) ---
    let response: ChatResponse | null = null;
    let usedEndpoint = endpoints[0];
    let lastError: unknown = null;

    for (const endpoint of endpoints) {
      try {
        if (endpoint.viaFallback) {
          yield { type: "status", text: "using_fallback", model: endpoint.cfg.model };
        }
        response = await factory(endpoint.cfg).chat({
          messages,
          tools: TOOL_DEFINITIONS,
          signal: params.signal,
        });
        usedEndpoint = endpoint;
        break;
      } catch (error) {
        if (error instanceof LlmNotConfiguredError) continue;
        if (params.signal?.aborted) throw error;
        lastError = error;
        logger.warn("LLM endpoint failed", {
          provider: endpoint.cfg.provider,
          model: endpoint.cfg.model,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!response) {
      const code =
        lastError && typeof lastError === "object" && "code" in lastError
          ? String((lastError as { code: unknown }).code)
          : "LLM_UNAVAILABLE";
      yield {
        type: "error",
        code,
        message:
          "The LLM provider could not complete this turn. No railway answer was generated and nothing was guessed.",
        retryable: true,
      };
      return;
    }

    // --- Model answered directly: done ---
    if (response.toolCalls.length === 0) {
      if (!response.content) {
        yield {
          type: "error",
          code: "LLM_MALFORMED_RESPONSE",
          message: "The model returned an empty response. Nothing was guessed.",
          retryable: true,
        };
        return;
      }
      store.appendAssistant(conv.id, response.content);
      yield {
        type: "message",
        text: response.content,
        model: usedEndpoint.cfg.model,
        viaFallback: usedEndpoint.viaFallback,
        cards: deriveCards(turnResults),
      };
      return;
    }

    // --- Model asked for tools: execute them (its decision, our boundary) ---
    messages.push({
      role: "assistant",
      content: response.content,
      tool_calls: response.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
      })),
    });

    for (const call of response.toolCalls) {
      const knownTool = TOOL_DEFINITIONS.some((d) => d.function.name === call.name);
      const correlationId = `${conv.id}:${turnId}:${call.id}`;

      if (!knownTool) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            tool: call.name,
            correlationId,
            status: "invalid_arguments",
            note: `Unknown tool "${call.name}". Use only the provided tools.`,
          }),
        });
        continue;
      }

      const argsKey = `${call.name}:${stableStringify(call.args)}`;
      const duplicateOf = executedCalls.get(argsKey);
      if (duplicateOf) {
        // Duplicate-call guard: don't re-run identical calls in one turn.
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            tool: call.name,
            correlationId,
            status: "invalid_arguments",
            note: `Duplicate call: you already ran ${call.name} with identical arguments (correlationId ${duplicateOf}) this turn. Use that result, or change the arguments.`,
          }),
        });
        continue;
      }

      yield {
        type: "tool_call",
        tool: call.name,
        correlationId,
        argsSummary: JSON.stringify(call.args ?? {}).slice(0, 200),
      };

      const result = await executeTool(
        call.name as never,
        call.args,
        call.rawArguments,
        { conversationId: conv.id, turnId, toolCallId: call.id, signal: params.signal },
      );
      executedCalls.set(argsKey, correlationId);
      turnResults.push(result);
      store.recordToolResult(conv.id, turnId, call.name, call.args, result);

      yield {
        type: "tool_result",
        tool: call.name,
        correlationId,
        status: result.status,
        summary: summarizeForUi(result),
        ...(result.source ? { source: result.source.providerId } : {}),
        ...(result.freshness ? { freshness: result.freshness } : {}),
        ...(result.journeyDate ? { journeyDate: result.journeyDate } : {}),
        ...(result.classCode ? { classCode: result.classCode } : {}),
      };

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: JSON.stringify(result),
      });
    }

    // Refresh the context block so the model sees the new results/refs and
    // any supersede marks before deciding the next step.
    messages[1] = { role: "system", content: store.buildContextBlock(conv, turnId, todayIso) };
  }

  // Iteration cap hit — honest stop, no canned answer.
  yield {
    type: "error",
    code: "TOOL_LOOP_LIMIT",
    message:
      "The assistant kept requesting tools without settling on an answer, so the turn was stopped. Nothing was guessed.",
    retryable: true,
  };
}
