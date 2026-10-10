import { respondToMessage } from "@/assistant/respond";
import { badRequest, jsonResponse, makeRequestId } from "@/lib/http";
import { logger } from "@/lib/logger";

/**
 * POST /api/assistant — conversational endpoint (hi/hinglish/en).
 * The LLM (when configured) is invoked server-side only; keys never reach
 * the client. Replies are grounded in provider envelopes.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = makeRequestId();
  const body = (await request.json().catch(() => null)) as {
    message?: unknown;
    locale?: unknown;
  } | null;

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return badRequest("Field 'message' (non-empty string) is required.");

  try {
    const reply = await respondToMessage(
      message.slice(0, 2000),
      typeof body?.locale === "string" ? body.locale : null,
    );
    return jsonResponse({ requestId, ...reply });
  } catch (error) {
    logger.error("assistant route failed", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      {
        requestId,
        error: { code: "UPSTREAM_ERROR", message: "Assistant failed to respond.", retryable: true },
      },
      { status: 500 },
    );
  }
}
