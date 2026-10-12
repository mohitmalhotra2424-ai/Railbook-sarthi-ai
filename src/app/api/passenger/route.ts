import { badRequest, jsonResponse } from "@/lib/http";
import { conversationStore } from "@/assistant/context/store";
import { evaluateReadiness, IRCTC_HANDOFF_READY, parseTimesFromLabel } from "@/assistant/booking/preparation";
import { validatePassengerField, validateCategory } from "@/assistant/passengers/validate";

export const dynamic = "force-dynamic";

/**
 * GET /api/passenger?conversationId=… — read-only snapshot for the review
 * page: authoritative selection, passengers, readiness, review, and the
 * latest non-superseded provider fare/availability for the selection
 * (honest freshness included; nothing invented).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId") ?? "";
  if (!CONVERSATION_ID_RX.test(conversationId)) return badRequest("conversationId is required.");
  const conv = conversationStore.get(conversationId);
  if (!conv) {
    return jsonResponse({ ok: true, selection: null, passengers: [], readiness: null, review: null, fare: null, availability: null, times: null });
  }
  const sel = conv.selection ?? null;
  const latest = (tool: string, match: (r: { classCode?: string }) => boolean) => {
    const refs = conv.results.filter(
      (r) => r.tool === tool && !r.supersededBy && r.trainNumber === sel?.trainNumber && match(r),
    );
    return refs.length ? refs[refs.length - 1] : undefined;
  };
  const fareRef = sel ? latest("GET_FARE", (r) => (r.classCode && sel.classCode ? r.classCode === sel.classCode : true)) : undefined;
  // Prompt 33: provider-reported dep/arr times for the selected train, read
  // from the current non-superseded SEARCH_TRAINS result row (never invented).
  const searchRefs = conv.results.filter((r) => r.tool === "SEARCH_TRAINS" && !r.supersededBy && r.items?.length);
  const selItem = sel
    ? [...searchRefs].reverse().flatMap((r) => r.items!).find((i) => i.label === sel.trainNumber || i.label.startsWith(`${sel.trainNumber} `))
    : undefined;
  const times = selItem ? parseTimesFromLabel(selItem.label) : null;
  const availRef = sel ? latest("CHECK_AVAILABILITY", () => true) : undefined;
  return jsonResponse({
    ok: true,
    selection: sel,
    passengers: conv.passengers,
    readiness: evaluateReadiness(conv),
    review: conv.review ?? null,
    fare: fareRef?.fare
      ? { ...fareRef.fare, retrievedAt: fareRef.retrievedAt ?? null, freshness: fareRef.freshness ?? "unknown" }
      : null,
    availability: availRef?.availability
      ? { classes: availRef.availability, retrievedAt: availRef.retrievedAt ?? null, freshness: availRef.freshness ?? "unknown" }
      : null,
    times,
  });
}

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
    category?: unknown;
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
    if (body.category !== undefined && !validateCategory(body.category).ok) return badRequest("Invalid passenger category.");
    const res = conversationStore.addPassenger(
      conversationId,
      body?.category === "infant_with_berth" || body?.category === "infant_without_berth" || body?.category === "passenger"
        ? body.category
        : undefined,
    );
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
