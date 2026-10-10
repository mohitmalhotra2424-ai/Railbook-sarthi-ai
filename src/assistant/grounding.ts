import type { Freshness, ResultEnvelope, SourceInfo } from "@/providers/types";
import type { ProviderError } from "@/domain/errors";
import { tr, type Locale } from "@/lib/i18n";
import { INTENT_TO_CAPABILITY, type Intent, type IntentType } from "./intents";

/**
 * GROUNDING CHOKE POINT (requirement 7).
 *
 * The assistant may only present facts that exist in provider envelope data.
 * This module renders replies strictly from `envelope.data` fields; when no
 * data exists it returns the honest not-configured / ask-parameters message.
 * It never computes, infers, defaults or “completes” any railway fact.
 */

export interface AssistantReply {
  text: string;
  locale: Locale;
  notConfigured: boolean;
  sources: Pick<SourceInfo, "providerId" | "authorization">[];
  retrievedAt: string | null;
  freshness: Freshness | null;
  contradictions: { field: string; values: { providerId: string; value: unknown }[] }[];
  errors: ProviderError[];
}

interface Renderable {
  [key: string]: unknown;
}

/** Renders ONLY fields present in the data. Missing fields are omitted. */
function renderDataForIntent(type: IntentType, data: unknown): string {
  const d = data as Renderable | Renderable[] | null;
  if (d === null || d === undefined) return "";
  switch (type) {
    case "search":
    case "cancellations": {
      const rows = (Array.isArray(d) ? d : []) as Renderable[];
      return rows
        .map((r) =>
          [r.trainNumber, r.trainName, r.kind ? `(${String(r.kind)})` : ""]
            .filter(Boolean)
            .join(" — "),
        )
        .join("\n");
    }
    case "pnr": {
      const pnr = d as Renderable;
      const passengers = (pnr.passengers as Renderable[] | undefined) ?? [];
      const lines = passengers.map(
        (p) => `Passenger ${String(p.passengerNumber)}: ${String(p.currentStatus)}`,
      );
      return [
        pnr.trainName ? `${String(pnr.trainName)} (${String(pnr.trainNumber ?? "?")})` : "",
        pnr.journeyDate ? `Journey: ${String(pnr.journeyDate)}` : "",
        ...lines,
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "liveStatus": {
      const s = d as Renderable;
      const last = s.lastStation as Renderable | null | undefined;
      return [
        `${String(s.trainNumber ?? "")} ${String(s.trainName ?? "")}`.trim(),
        s.running === null || s.running === undefined ? "" : `Running: ${String(s.running)}`,
        last ? `Last station: ${String(last.name ?? last.code ?? "")}` : "",
        s.delayMinutes === null || s.delayMinutes === undefined
          ? ""
          : `Delay: ${String(s.delayMinutes)} min`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "fare": {
      const f = d as Renderable;
      return `${String(f.classCode ?? "")}: total ${String(f.totalFare ?? "")} ${String(f.currency ?? "INR")}`;
    }
    case "availability": {
      const a = d as Renderable;
      const classes = (a.classes as Renderable[] | undefined) ?? [];
      return classes
        .map((c) => `${String(c.classCode)}: ${String(c.status)}`)
        .join("\n");
    }
    case "timetable": {
      const t = d as Renderable;
      const entries = (t.entries as Renderable[] | undefined) ?? [];
      return entries
        .map((e) => {
          const st = e.station as Renderable | undefined;
          return `${String(st?.name ?? "")} arr ${String(e.arrival ?? "-")} dep ${String(e.departure ?? "-")}`;
        })
        .join("\n");
    }
    default:
      return "";
  }
}

export function buildAssistantReply(
  intent: Intent,
  envelopes: ResultEnvelope<unknown>[],
  locale: Locale,
): AssistantReply {
  const meta = {
    locale,
    sources: envelopes.map((e) => ({
      providerId: e.source.providerId,
      authorization: e.source.authorization,
    })),
    retrievedAt: envelopes[0]?.retrievedAt ?? null,
    freshness: envelopes[0]?.freshness ?? null,
    contradictions: envelopes.flatMap((e) => e.contradictions ?? []),
    errors: envelopes.flatMap((e) => e.errors),
  };

  if (intent.type === "greeting" || intent.type === "unknown") {
    // Deterministic fallback (the LLM may only re-phrase this, never add facts).
    return { ...meta, text: tr("assistantGreeting", locale), notConfigured: false };
  }

  if (intent.type === "pnr" && !intent.entities.pnr) {
    const configuredElsewhere = envelopes.length > 0;
    return {
      ...meta,
      text: tr("assistantAskPnr", locale),
      notConfigured: !configuredElsewhere && meta.sources.length === 0 ? true : false,
    };
  }

  const isDataIntent = Boolean(INTENT_TO_CAPABILITY[intent.type]);

  if (envelopes.length === 0) {
    // Data intent but no envelope was produced: we lacked structured
    // parameters AND a provider exists (otherwise respond.ts supplies the
    // canonical NOT_CONFIGURED envelope).
    return {
      ...meta,
      text: isDataIntent ? tr("assistantAskParams", locale) : tr("assistantGreeting", locale),
      notConfigured: false,
    };
  }

  const withData = envelopes.filter((e) => e.data !== null && e.data !== undefined);
  if (withData.length === 0) {
    const allNotConfigured = envelopes.every((e) =>
      e.errors.some((x) => x.code === "NOT_CONFIGURED"),
    );
    return {
      ...meta,
      text: allNotConfigured
        ? tr("assistantNoProvider", locale)
        : tr("assistantNoData", locale),
      notConfigured: allNotConfigured,
    };
  }

  const grounded = withData
    .map((e) => renderDataForIntent(intent.type, e.data))
    .filter(Boolean)
    .join("\n\n");
  const uncertainty =
    meta.contradictions.length > 0 ? `\n\n${tr("uncertaintyNotice", locale)}` : "";
  return { ...meta, text: `${grounded}${uncertainty}`, notConfigured: false };
}
