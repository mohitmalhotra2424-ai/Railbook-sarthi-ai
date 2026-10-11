import { randomUUID } from "node:crypto";
import { badRequest, jsonResponse } from "@/lib/http";
import { logger } from "@/lib/logger";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CONVERSATION_ID_RX = /^[a-zA-Z0-9_-]{8,64}$/;

/**
 * POST /api/assistant — the conversational endpoint.
 *
 * Body: { conversationId?: string, message: string }
 * Response: text/event-stream of TurnEvents (status/tool_call/tool_result/
 * message/error/done). The LLM runs server-side only; credentials never
 * reach the client.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    conversationId?: unknown;
    message?: unknown;
  } | null;

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return badRequest("Field 'message' (non-empty string) is required.");
  if (message.length > 4000) return badRequest("Message too long (max 4000 characters).");

  let conversationId: string;
  if (typeof body?.conversationId === "string" && body.conversationId) {
    if (!CONVERSATION_ID_RX.test(body.conversationId)) {
      return badRequest("conversationId must be 8-64 chars of [a-zA-Z0-9_-].");
    }
    conversationId = body.conversationId;
  } else {
    conversationId = randomUUID();
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: TurnEvent | { type: "done" }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      // First event tells the client the (possibly server-generated) id.
      send({ type: "status", text: "thinking" } as TurnEvent);
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "conversation", conversationId })}\n\n`),
      );
      try {
        // Prompt 20 §1/§7: per-turn resilience metrics — counters only,
        // never message content, passenger data or credentials.
        const startedAt = Date.now();
        let toolResults = 0;
        let toolErrors = 0;
        let llmErrors = 0;
        let usedFallback = false;
        let outcome = "ok";
        for await (const event of runTurn({
          conversationId,
          message: message.slice(0, 4000),
          signal: request.signal,
        })) {
          if (event.type === "tool_result") toolResults += 1;
          if (event.type === "error") {
            outcome = "error";
            if (String(event.code).startsWith("LLM_")) llmErrors += 1;
            else toolErrors += 1;
          }
          if (event.type === "message" && event.viaFallback) usedFallback = true;
          send(event);
        }
        logger.info("assistant turn completed", {
          conversationId,
          durationMs: Date.now() - startedAt,
          toolResults,
          toolErrors,
          llmErrors,
          usedFallback,
          outcome,
          aborted: request.signal.aborted,
        });
      } catch (error) {
        if (!request.signal.aborted) {
          logger.error("assistant turn crashed", {
            conversationId,
            error: error instanceof Error ? error.message : String(error),
          });
          send({
            type: "error",
            code: "INTERNAL_ERROR",
            message: "The assistant hit an unexpected error. Nothing was guessed.",
            retryable: true,
          });
        }
      } finally {
        send({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-conversation-id": conversationId,
    },
  });
}

/** Health probe for the endpoint itself (GET). */
export async function GET(): Promise<Response> {
  return jsonResponse({ ok: true, endpoint: "/api/assistant", method: "POST" });
}
