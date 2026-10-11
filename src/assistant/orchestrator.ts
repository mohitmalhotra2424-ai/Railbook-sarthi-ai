import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import { readLlmConfigs, type LlmEndpointConfig } from "./llm/config";
import {
  LlmNotConfiguredError,
  OpenAiCompatibleClient,
  type ChatMessage,
  type ChatResponse,
} from "./llm/client";
import { conversationStore, ConversationStore, REQUIRED_PASSENGER_FIELDS } from "./context/store";
import { evaluateReadiness } from "./booking/preparation";
import { guardSaveClaims } from "./passengers/save-claim-guard";
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
  classes?: string[];
  journeyDate?: string;
  /** Per-class availability only when the provider published it. */
  availability?: { classCode: string; status: string; asOf?: string | null }[];
}

/** Structured, provider-backed blocks rendered as purpose-built cards in chat. */
export type ResultBlock = {
  source?: string;
  freshness?: string;
  retrievedAt?: string;
  providerTimestamp?: string | null;
} & (
  | { kind: "availability"; data: import("@/domain/schemas").Availability }
  | { kind: "fare"; data: import("@/domain/schemas").Fare }
  | { kind: "live"; data: import("@/domain/schemas").LiveStatus }
  | { kind: "pnr"; data: import("@/domain/schemas").PnrStatus }
);

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
  | { type: "message"; text: string; model: string; viaFallback: boolean; cards: TrainCard[]; blocks: ResultBlock[] }
  | {
      type: "passenger_form";
      selection: import("./context/store").SelectionState | null;
      passengers: import("./context/store").PassengerDraft[];
      /** Prompt 31: deterministic readiness + review state (backend-authoritative). */
      readiness: import("./booking/preparation").ReadinessResult;
      review: import("./context/store").ReviewState | null;
    }
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
      const rawClasses = Array.isArray(row.classes)
        ? row.classes.filter((c): c is string => typeof c === "string")
        : undefined;
      cards.push({
        trainNumber: row.trainNumber,
        trainName: row.trainName,
        from: `${from?.name ?? ""}${from?.code ? ` (${from.code})` : ""}`.trim(),
        to: `${to?.name ?? ""}${to?.code ? ` (${to.code})` : ""}`.trim(),
        departure: String(row.departure ?? ""),
        arrival: String(row.arrival ?? ""),
        // Only fields the provider actually returned — UI labels missing ones.
        ...(rawClasses && rawClasses.length > 0 ? { classes: rawClasses } : {}),
        ...(typeof result.journeyDate === "string" && result.journeyDate ? { journeyDate: result.journeyDate } : {}),
        // Provenance on every card: which provider, when we fetched it.
        ...(result.source ? { source: result.source.providerId } : {}),
        ...(result.retrievedAt ? { retrievedAt: result.retrievedAt } : {}),
        ...(result.providerTimestamp !== undefined ? { providerTimestamp: result.providerTimestamp } : {}),
        ...(Array.isArray(row.availability) && row.availability.length > 0
          ? {
              availability: (row.availability as { classCode: string; status: string; asOf?: string | null }[]).map(
                (a) => ({ classCode: a.classCode, status: a.status, asOf: a.asOf ?? null }),
              ),
            }
          : {}),
      });
    }
  }
  return cards;
}

const BLOCK_TOOL: Record<string, ResultBlock["kind"]> = {
  CHECK_AVAILABILITY: "availability",
  GET_FARE: "fare",
  TRACK_TRAIN: "live",
  CHECK_PNR: "pnr",
};

/** Attach structured provider data (never invented) for purpose-built cards. */
function deriveBlocks(turnResults: ToolResult[]): ResultBlock[] {
  const blocks: ResultBlock[] = [];
  for (const result of turnResults) {
    if ((result.status !== "ok" && result.status !== "stale") || !result.data) continue;
    const kind = BLOCK_TOOL[result.tool];
    if (!kind) continue;
    blocks.push({
      kind,
      data: result.data as never,
      ...(result.source ? { source: result.source.providerId } : {}),
      ...(result.freshness ? { freshness: result.freshness } : {}),
      ...(result.retrievedAt ? { retrievedAt: result.retrievedAt } : {}),
      providerTimestamp: result.providerTimestamp ?? null,
    });
  }
  return blocks;
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
  // Prompt 28 — bounded tool-call recovery. When the P26 guard blocks an
  // unsupported save claim for a field that authoritative state still lists
  // as missing, ONE additional LLM request may be made this turn asking the
  // model to use the existing tool. Strictly once per turn, never recursive.
  let recoveryUsed = false;
  /** Honest P26 fallback to deliver if the recovery request itself fails. */
  let recoveryFallback: { text: string; model: string; viaFallback: boolean } | null = null;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations += 1;
    // Client left (abort): stop silently — a dead request must never mutate
    // the store or emit events (Prompt 19 §5).
    if (params.signal?.aborted) return;
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
      // Prompt 28: if this failed request was the bounded recovery attempt,
      // the user still gets the honest P26 fallback — never a raw error on
      // top of an already-corrected turn, and never a false save claim.
      if (recoveryFallback) {
        if (params.signal?.aborted) return;
        store.appendAssistant(conv.id, recoveryFallback.text);
        yield {
          type: "message",
          text: recoveryFallback.text,
          model: recoveryFallback.model,
          viaFallback: recoveryFallback.viaFallback,
          cards: deriveCards(turnResults),
          blocks: deriveBlocks(turnResults),
        };
        return;
      }
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

    // P27 diagnostic (sanitized): distinguishes "model chose plain text"
    // (finishReason=stop) from "provider advertised tool_calls but delivered
    // none" — counts only, never message content or passenger data.
    logger.info("LLM response shape", {
      provider: usedEndpoint.cfg.provider,
      finishReason: response.finishReason,
      toolCallCount: response.toolCalls.length,
      contentChars: response.content?.length ?? 0,
    });

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
      if (params.signal?.aborted) return; // superseded: drop, don't mutate
      // Prompt 26 — verified save-claim guard: the delivered response may not
      // claim a passenger field was saved unless this turn's tool results or
      // the current authoritative form state support it. Text and voice both
      // consume this single message event, so both channels stay truthful.
      const guardSnap = store.get(conv.id);
      const guarded = guardSaveClaims({
        text: response.content,
        turnResults,
        passengers: guardSnap?.passengers ?? [],
      });
      if (guarded.adjusted) {
        logger.warn("save-claim guard replaced an unsupported confirmation", {
          conversationId: conv.id,
          turnId,
          blockedFields: guarded.blockedClaims.map((b) => b.field),
        });
      }
      // Prompt 28 — bounded recovery trigger. Conditions (all required):
      //  1. the P26 guard blocked an unsupported save claim this turn;
      //  2. the claimed field is still missing in authoritative current state;
      //  3. the validated context supports a legitimate update (form open);
      //  4. no recovery has been used this turn and the step budget remains.
      // Exactly ONE extra request; it re-enters the same loop, so any tool
      // call goes through the existing validation/dispatch/result pipeline.
      const paxNow = guardSnap?.passengers ?? [];
      const currentPax = paxNow[paxNow.length - 1] ?? {};
      const missingNow: readonly string[] = REQUIRED_PASSENGER_FIELDS.filter(
        (f) => currentPax[f] === undefined,
      );
      // Prompt 29 — recovery is strictly AGE-ONLY: no other passenger field,
      // no railway tool, no general conversation is ever eligible.
      const recoverable =
        guarded.adjusted &&
        !recoveryUsed &&
        iterations < MAX_TOOL_ITERATIONS &&
        Boolean(guardSnap?.selection?.classCode) && // form open, session verified
        missingNow.includes("age") && // age authoritatively still missing
        guarded.blockedClaims.some((b) => b.field === "age");
      if (recoverable) {
        recoveryUsed = true;
        recoveryFallback = {
          text: guarded.text,
          model: usedEndpoint.cfg.model,
          viaFallback: usedEndpoint.viaFallback,
        };
        logger.warn("save-claim recovery: one bounded re-ask", {
          conversationId: conv.id,
          turnId,
          fields: guarded.blockedClaims.map((b) => b.field),
        });
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "system",
          content:
            "RECOVERY: Your last reply claimed a passenger detail was saved, but no UPDATE_PASSENGER call succeeded this turn and that field is still MISSING in the FORM STATE. If the user already supplied the value, call UPDATE_PASSENGER now with exactly that value; if you do not have a valid value, ask the user to repeat it. Never claim a detail is saved without a successful tool result.",
        });
        continue;
      }
      store.appendAssistant(conv.id, guarded.text);
      yield {
        type: "message",
        text: guarded.text,
        model: usedEndpoint.cfg.model,
        viaFallback: usedEndpoint.viaFallback,
        cards: deriveCards(turnResults),
        blocks: deriveBlocks(turnResults),
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
        { conversationId: conv.id, turnId, toolCallId: call.id, signal: params.signal, store },
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

      // Prompt 25: keep the UI's selection/passenger-form state authoritative.
      if (
        result.status === "ok" &&
        (call.name === "SELECT_TRAIN" || call.name === "SELECT_CLASS" || call.name === "UPDATE_PASSENGER")
      ) {
        const snap = store.get(conv.id);
        yield {
          type: "passenger_form",
          selection: snap?.selection ?? null,
          passengers: snap?.passengers ?? [],
          readiness: evaluateReadiness(snap!),
          review: snap?.review ?? null,
        };
      }

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
