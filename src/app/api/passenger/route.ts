import { badRequest, jsonResponse } from "@/lib/http";
import { conversationStore } from "@/assistant/context/store";
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

  if (body?.action === "add") {
    const res = conversationStore.addPassenger(conversationId);
    if (!res.ok) return jsonResponse({ ok: false, error: res.error }, { status: 400 });
    const conv = conversationStore.get(conversationId);
    return jsonResponse({ ok: true, selection: conv?.selection ?? null, passengers: res.passengers });
  }

  const checked = validatePassengerField(String(body?.field ?? ""), body?.value);
  if (!checked.ok) return jsonResponse({ ok: false, error: checked.error }, { status: 400 });

  const index = typeof body?.passengerIndex === "number" ? body.passengerIndex : 1;
  const res = conversationStore.updatePassenger(conversationId, index, checked.patch);
  if (!res.ok) return jsonResponse({ ok: false, error: res.error }, { status: 400 });

  const conv = conversationStore.get(conversationId);
  return jsonResponse({ ok: true, selection: conv?.selection ?? null, passengers: res.passengers });
}
