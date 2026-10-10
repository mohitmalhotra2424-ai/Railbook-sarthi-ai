import { randomUUID } from "node:crypto";
import { parseLocale, type Locale } from "@/lib/i18n";
import { notConfiguredEnvelope } from "@/providers/envelope";
import { executeCapability, resolveProviders } from "@/providers/registry";
import type {
  PnrProvider,
  QueryContext,
  ResultEnvelope,
  TrainSearchProvider,
} from "@/providers/types";
import { buildAssistantReply, type AssistantReply } from "./grounding";
import { detectIntent, INTENT_TO_CAPABILITY, type Intent } from "./intents";
import { completeWithLlm } from "./llm/client";

/**
 * Assistant orchestrator.
 *
 * Data policy (requirement 7): railway FACTS always come from provider
 * envelopes, rendered deterministically by grounding.ts. The LLM (when
 * configured) is used ONLY for conversational phrasing of greetings and
 * unknown intents — never for data intents, so it can never become a source
 * of invented train numbers, fares, PNR statuses or timings.
 */

async function gatherEnvelopes(
  intent: Intent,
  requestId: string,
): Promise<ResultEnvelope<unknown>[]> {
  const capability = INTENT_TO_CAPABILITY[intent.type];
  if (!capability) return [];

  const ctx: QueryContext = { locale: intent.locale, requestId };

  if (intent.type === "pnr") {
    const pnr = intent.entities.pnr;
    if (!pnr) {
      // No PNR number in the message. If nothing is configured, still
      // surface the canonical not-configured state; otherwise ask for it.
      return resolveProviders("pnr").length === 0
        ? [notConfiguredEnvelope("pnr", requestId)]
        : [];
    }
    const env = await executeCapability(
      "pnr",
      (p) => (p as PnrProvider).pnr(pnr, ctx),
      requestId,
    );
    return [env as ResultEnvelope<unknown>];
  }

  if (intent.type === "search") {
    const env = await executeCapability(
      "trainSearch",
      (p) => (p as TrainSearchProvider).search({ text: intent.entities.raw }, ctx),
      requestId,
    );
    return [env as ResultEnvelope<unknown>];
  }

  // Parameterized capabilities (liveStatus, fare, seatAvailability,
  // timetable, cancellations): Phase 1 chat does not extract entities from
  // free text — guessing them would violate requirement 7. When no provider
  // is configured we surface the canonical NOT_CONFIGURED envelope; when one
  // is configured we ask the user for structured parameters instead.
  return resolveProviders(capability).length === 0
    ? [notConfiguredEnvelope(capability, requestId)]
    : [];
}

const CONVERSATIONAL_SYSTEM_PROMPT =
  "You are RailSaarthi, a friendly Indian railway assistant. Reply in the user's language (Hindi, Hinglish or English). " +
  "HARD RULE: You must NEVER state or invent train numbers, train names, fares, seat availability, PNR statuses, platform numbers or timings. " +
  "Railway data in this product comes only from authorized providers surfaced by the app. If asked for railway data, tell the user to use the search/PNR/status pages, " +
  "and that live data appears only when an authorized provider is configured. Keep replies under 60 words.";

export async function respondToMessage(
  message: string,
  localeHint?: string | null,
): Promise<AssistantReply> {
  const intent = detectIntent(message);
  const locale: Locale = localeHint ? parseLocale(localeHint) : intent.locale;
  const requestId = randomUUID();

  const envelopes = await gatherEnvelopes(intent, requestId);
  const reply = buildAssistantReply(intent, envelopes, locale);

  // LLM is used ONLY for conversational (non-data) intents. Data replies are
  // deterministic and grounded; the LLM never sees or produces railway facts.
  if (intent.type === "greeting" || intent.type === "unknown") {
    const llm = await completeWithLlm({
      messages: [
        { role: "system", content: CONVERSATIONAL_SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
      temperature: 0.4,
      maxOutputTokens: 220,
    });
    if (llm && llm.text.trim()) {
      return { ...reply, text: llm.text.trim() };
    }
  }

  return reply;
}
