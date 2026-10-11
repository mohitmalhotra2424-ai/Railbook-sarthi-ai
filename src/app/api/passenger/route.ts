import { badRequest, jsonResponse } from "@/lib/http";
import { conversationStore } from "@/assistant/context/store";
import { evaluateReadiness, IRCTC_HANDOFF_READY } from "@/assistant/booking/preparation";
import { validatePassengerField } from "@/assistant/passengers/validate";

export const dynamic = "force-dynamic";

const CONVERSATION_ID_RX = /^[a-zA-Z0-9_-]{8,64}$/;

/**
 * POST /api/passenger — manual fallback edits for the passenger form.
 * Uses the EXACT same validation + store path as the chat/voice action
 * (UPDATE_PASSENGER): the LLM never mutates state directly, and neither
 * does the UI. Data-collection/review only — no booking, no payment.
 * Passenger values are never logged.
 *
 * Body: { conversationId, passengerIndex?, field, value }
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    conversationId?: unknown;
    passengerIndex?: unknown;
    field?: unknown;
    value?: unknown;
    action?: unknown;
  } | null;

  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
  if (!CONVERSATION_ID_RX.test(conversationId)) return badRequest("conversationId is required.");

  // Prompt 31: deterministic review build — only when preparation is ready.
  if (body?.action === "review") {
    const conv = conversationStore.get(conversationId);
    const readiness = conv ? evaluateReadiness(conv) : null;
    const res = conversationStore.buildReview(conversationId);
    const after = conversationStore.get(conversationId);
    if (!res.ok) {
      return jsonResponse(
        { ok: false, error: res.error, readiness, selection: after?.selection ?? null, passengers: after?.passengers ?? [], review: after?.review ?? null },
        { status: 400 },
      );
    }
    return jsonResponse({ ok: true, selection: after?.selection ?? null, passengers: after?.passengers ?? [], review: res.review, readiness });
  }

  // Prompt 31: confirmation only for the current, awaiting, un-staled review.
  if (body?.action === "confirm") {
    const res = conversationStore.confirmReview(conversationId);
    const after = conversationStore.get(conversationId);
    const readiness = after ? evaluateReadiness(after) : null;
    if (!res.ok) {
      return jsonResponse(
        { ok: false, error: res.error, readiness, selection: after?.selection ?? null, passengers: after?.passengers ?? [], review: after?.review ?? null },
        { status: 400 },
      );
    }
    return jsonResponse({ ok: true, selection: after?.selection ?? null, passengers: after?.passengers ?? [], review: res.review, readiness, handoff: IRCTC_HANDOFF_READY });
  }

  if (body?.action === "add") {
    const res = conversationStore.addPassenger(conversationId);
    if (!res.ok) return jsonResponse({ ok: false, error: res.error }, { status: 400 });
    const conv = conversationStore.get(conversationId);
    return jsonResponse({ ok: true, selection: conv?.selection ?? null, passengers: res.passengers, review: conv?.review ?? null, readiness: conv ? evaluateReadiness(conv) : null });
  }

  const checked = validatePassengerField(String(body?.field ?? ""), body?.value);
  if (!checked.ok) return jsonResponse({ ok: false, error: checked.error }, { status: 400 });

  const index = typeof body?.passengerIndex === "number" ? body.passengerIndex : 1;
  const res = conversationStore.updatePassenger(conversationId, index, checked.patch);
  if (!res.ok) return jsonResponse({ ok: false, error: res.error }, { status: 400 });

  const conv = conversationStore.get(conversationId);
  return jsonResponse({ ok: true, selection: conv?.selection ?? null, passengers: res.passengers, review: conv?.review ?? null, readiness: conv ? evaluateReadiness(conv) : null });
}
