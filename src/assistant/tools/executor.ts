import { z } from "zod";
import { conversationStore, type ConversationStore } from "@/assistant/context/store";
import { validatePassengerField } from "@/assistant/passengers/validate";
import { parseTimesFromLabel } from "@/assistant/booking/preparation";
import { logger } from "@/lib/logger";
import { isNotConfigured } from "@/providers/envelope";
import { executeCapabilityFailover } from "@/providers/registry";
import type {
  CancellationsProvider,
  FareProvider,
  LiveStatusProvider,
  PnrProvider,
  QueryContext,
  ResultEnvelope,
  SeatAvailabilityProvider,
  TimetableProvider,
  TrainDetailsProvider,
  TrainSearchProvider,
} from "@/providers/types";
import { TOOL_ARG_SCHEMAS, type ToolName } from "./schemas";
import type { ToolResult, ToolResultStatus } from "./results";

/**
 * Tool executor — a deterministic technical boundary ONLY (requirement 1):
 * schema validation, timeouts, correlation, provider invocation and honest
 * status mapping. It performs NO intent interpretation and never decides
 * which tool to run — that is exclusively the LLM's decision.
 */

export interface ToolExecutionMeta {
  conversationId: string;
  turnId: string;
  toolCallId: string;
  signal?: AbortSignal;
  /** Prompt 25: application actions operate on the turn's store. */
  store?: ConversationStore;
}

const TOOL_TIMEOUT_MS = 15_000;

const NOTES: Record<ToolResultStatus, string> = {
  ok: "Live provider data. Report exactly what is here; add nothing.",
  not_configured:
    "No authorized live railway provider is configured for this lookup. Tell the user honestly that live data is unavailable right now. Do NOT invent trains, fares, timings, availability or statuses.",
  unavailable:
    "The provider returned no usable data. Say it is unavailable; do not guess.",
  stale: "Data returned but it is stale. Mention that it may be outdated, or offer to re-check.",
  invalid_arguments:
    "Arguments failed validation and the tool did NOT run. Fix the arguments and retry, or ask the user for the missing detail.",
  timeout: "The provider timed out. Offer to retry; do not guess results.",
  error: "Technical provider failure. Offer to retry; do not guess results.",
};

function baseResult(tool: string, meta: ToolExecutionMeta, status: ToolResultStatus, note?: string): ToolResult {
  return {
    tool,
    correlationId: `${meta.conversationId}:${meta.turnId}:${meta.toolCallId}`,
    status,
    note: note ?? NOTES[status],
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`TOOL_TIMEOUT after ${ms}ms`)), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("ABORTED"));
      },
      { once: true },
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function mapEnvelope<T>(
  tool: string,
  meta: ToolExecutionMeta,
  envelope: ResultEnvelope<T | null>,
  extra: { journeyDate?: string; classCode?: string } = {},
): ToolResult {
  const base = {
    tool,
    correlationId: `${meta.conversationId}:${meta.turnId}:${meta.toolCallId}`,
    source: {
      providerId: envelope.source.providerId,
      authorization: envelope.source.authorization,
    },
    retrievedAt: envelope.retrievedAt,
    providerTimestamp: envelope.providerTimestamp ?? null,
    freshness: envelope.freshness,
    ...extra,
  };

  if (isNotConfigured(envelope)) {
    return { ...base, status: "not_configured", note: NOTES.not_configured, errors: envelope.errors };
  }
  if (envelope.data === null) {
    return {
      ...base,
      status: envelope.errors.length ? "error" : "unavailable",
      note: envelope.errors.length ? NOTES.error : NOTES.unavailable,
      errors: envelope.errors,
    };
  }
  if (envelope.freshness === "stale") {
    return { ...base, status: "stale", note: NOTES.stale, data: envelope.data, errors: envelope.errors };
  }
  // RAC / WL / REGRET / "no seats" live inside `data` — they are VALID
  // outcomes and stay status "ok" by design.
  return { ...base, status: "ok", note: NOTES.ok, data: envelope.data, errors: envelope.errors };
}

export async function executeTool(
  tool: ToolName,
  rawArgs: Record<string, unknown> | null,
  rawArguments: string | undefined,
  meta: ToolExecutionMeta,
): Promise<ToolResult> {
  // 1) Validation boundary — before ANY execution.
  const schema = TOOL_ARG_SCHEMAS[tool];
  if (rawArgs === null) {
    return {
      ...baseResult(tool, meta, "invalid_arguments"),
      note: `Model emitted unparseable arguments JSON${rawArguments ? `: ${rawArguments.slice(0, 200)}` : ""}. ${NOTES.invalid_arguments}`,
    };
  }
  const parsed = schema.safeParse(rawArgs);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .slice(0, 5)
      .join("; ");
    return {
      ...baseResult(tool, meta, "invalid_arguments"),
      note: `Validation failed — ${issues}. ${NOTES.invalid_arguments}`,
    };
  }
  const args = parsed.data as Record<string, unknown>;

  // 2) GENERAL_RAILWAY_ANSWER performs no external calls (provenance marker).
  if (tool === "GENERAL_RAILWAY_ANSWER") {
    return {
      ...baseResult(tool, meta, "ok"),
      note: "General-knowledge answer path. Answer the user's question from railway knowledge in their language; make clear it is general information, not live data.",
      data: { kind: "general_knowledge", question: (args as { question: string }).question },
    };
  }


  // ---- Prompt 37: deterministic filter/sort over the CURRENT authoritative
  // search results. Derived view only — the source results are never mutated.
  if (tool === "FILTER_TRAINS") {
    const a = args as z.infer<typeof TOOL_ARG_SCHEMAS.FILTER_TRAINS>;
    const fStore = meta.store ?? conversationStore;
    const conv = fStore.getOrCreate(meta.conversationId);
    const searchRefs = conv.results.filter((r) => r.tool === "SEARCH_TRAINS" && !r.supersededBy && r.items?.length);
    const srcRef = searchRefs[searchRefs.length - 1];
    if (!srcRef) {
      return {
        ...baseResult(tool, meta, "error"),
        note: "There are no current train search results to filter. Run SEARCH_TRAINS for the user's route/date first.",
      };
    }
    const toMin = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };
    type FRow = {
      index: number;
      trainNumber: string;
      trainName: string;
      departure: string | null;
      arrival: string | null;
      durationMin: number | null;
      classes: string[];
      fare?: number;
      fareClass?: string;
      availabilityStatus?: { classCode: string; status: string };
    };
    const rows: FRow[] = srcRef.items!.map((item) => {
      const times = parseTimesFromLabel(item.label);
      const dur =
        times && times.arrival
          ? (() => {
              const d = toMin(times.arrival!) - toMin(times.departure);
              return d <= 0 ? d + 24 * 60 : d; // overnight arrival
            })()
          : null;
      return {
        index: item.index,
        trainNumber: item.label.split(" ")[0],
        trainName: item.label
          .replace(/^\d+\s+/, "")
          .replace(/\s+dep\s.*$/, "")
          .replace(/\s+\[[^\]]*\]$/, "")
          .trim(),
        departure: times?.departure ?? null,
        arrival: times?.arrival ?? null,
        durationMin: dur,
        classes: item.classes ?? [],
      };
    });
    let matched = rows.filter((r) => {
      if (a.classCode && !r.classes.includes(a.classCode)) return false;
      if (a.departsAfter && (r.departure === null || toMin(r.departure) < toMin(a.departsAfter))) return false;
      if (a.departsBefore && (r.departure === null || toMin(r.departure) > toMin(a.departsBefore))) return false;
      if (a.arrivesAfter && (r.arrival === null || toMin(r.arrival) < toMin(a.arrivesAfter))) return false;
      if (a.arrivesBefore && (r.arrival === null || toMin(r.arrival) > toMin(a.arrivesBefore))) return false;
      if (a.maxDurationMinutes !== undefined && (r.durationMin === null || r.durationMin > a.maxDurationMinutes)) return false;
      return true;
    });
    // availableOnly: only CURRENT recorded live checks — absence or stale data
    // excludes the train honestly (never presented as available).
    let noAvailData = 0;
    if (a.availableOnly) {
      matched = matched.filter((r) => {
        const refs = conv.results.filter(
          (x) =>
            x.tool === "CHECK_AVAILABILITY" &&
            !x.supersededBy &&
            x.freshness !== "stale" &&
            x.trainNumber === r.trainNumber &&
            x.availability?.length,
        );
        const entry = refs.length
          ? refs[refs.length - 1].availability!.find((c) => !a.classCode || c.classCode === a.classCode)
          : undefined;
        if (!entry) {
          noAvailData += 1;
          return false;
        }
        r.availabilityStatus = entry;
        return true;
      });
    }
    // Fares: only from current, non-superseded GET_FARE results.
    let faresKnown = 0;
    for (const r of matched) {
      const fRefs = conv.results.filter(
        (x) =>
          x.tool === "GET_FARE" &&
          !x.supersededBy &&
          x.freshness !== "stale" &&
          x.trainNumber === r.trainNumber &&
          x.fare &&
          (!a.classCode || !x.classCode || x.classCode === a.classCode),
      );
      const fare = fRefs.length ? fRefs[fRefs.length - 1].fare! : undefined;
      if (fare) {
        r.fare = fare.totalFare;
        r.fareClass = fare.classCode;
        faresKnown += 1;
      }
    }
    const far = (v: number | null) => (v === null ? Number.MAX_SAFE_INTEGER : v);
    if (a.sortBy === "duration") matched.sort((x, y) => far(x.durationMin) - far(y.durationMin));
    else if (a.sortBy === "departure") matched.sort((x, y) => far(x.departure ? toMin(x.departure) : null) - far(y.departure ? toMin(y.departure) : null));
    else if (a.sortBy === "arrival") matched.sort((x, y) => far(x.arrival ? toMin(x.arrival) : null) - far(y.arrival ? toMin(y.arrival) : null));
    else if (a.sortBy === "fare") matched.sort((x, y) => far(x.fare ?? null) - far(y.fare ?? null));

    const criteria = [
      a.classCode ? `class ${a.classCode}` : null,
      a.availableOnly ? "recorded-available only" : null,
      a.departsAfter ? `departs ≥${a.departsAfter}` : null,
      a.departsBefore ? `departs ≤${a.departsBefore}` : null,
      a.arrivesAfter ? `arrives ≥${a.arrivesAfter}` : null,
      a.arrivesBefore ? `arrives ≤${a.arrivesBefore}` : null,
      a.maxDurationMinutes !== undefined ? `duration ≤${a.maxDurationMinutes}m` : null,
      a.sortBy ? `sorted by ${a.sortBy}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const shown = matched.slice(0, 8); // bounded for the LLM context
    const more = matched.length - shown.length;
    const list = shown
      .map(
        (r, i) =>
          `${i + 1}) ${r.trainNumber} ${r.trainName}${r.departure ? ` dep ${r.departure}` : ""}${r.arrival ? ` arr ${r.arrival}` : ""}${
            r.durationMin !== null ? ` (${Math.floor(r.durationMin / 60)}h${String(r.durationMin % 60).padStart(2, "0")}m)` : ""
          }${r.fare !== undefined ? ` ₹${r.fare}${r.fareClass ? `/${r.fareClass}` : ""}` : ""}${r.availabilityStatus ? ` [${r.availabilityStatus.classCode}:${r.availabilityStatus.status}]` : ""}`,
      )
      .join("; ");
    const extras = [
      a.sortBy === "fare" ? `Fare known for ${faresKnown}/${matched.length} (unchecked trains listed last; use GET_FARE to fetch real prices).` : null,
      a.availableOnly
        ? `Availability shown only from current recorded live checks${noAvailData ? `; ${noAvailData} matching trains had no recorded availability and were excluded — run CHECK_AVAILABILITY to include them` : ""}.`
        : null,
    ]
      .filter(Boolean)
      .join(" ");
    const note =
      matched.length === 0
        ? `0 of ${rows.length} current results match (${criteria}). Nothing was weakened or invented — tell the user honestly and suggest ONE sensible adjustment (wider time window, another class, or dropping a filter), then ask.`
        : `${matched.length} of ${rows.length} current results match (${criteria}). ${list}${more ? ` (+${more} more matching — the user can select any by train number)` : ""} ${extras} Selection still validates against the FULL authoritative search results.`;
    const data = matched.map((r) => ({
      trainNumber: r.trainNumber,
      trainName: r.trainName,
      from: { name: srcRef.route?.from ?? "" },
      to: { name: srcRef.route?.to ?? "" },
      departure: r.departure ?? undefined,
      arrival: r.arrival ?? undefined,
      classes: r.classes.length ? r.classes : undefined,
      ...(r.availabilityStatus ? { availability: [{ classCode: r.availabilityStatus.classCode, status: r.availabilityStatus.status, asOf: null }] } : {}),
    }));
    return {
      ...baseResult(tool, meta, "ok"),
      note,
      data,
      journeyDate: srcRef.journeyDate,
    };
  }

  // ---- Prompt 25: application actions — LLM proposes, backend validates ----
  const p25store = meta.store ?? conversationStore;
  if (tool === "SELECT_TRAIN") {
    const a = args as z.infer<typeof TOOL_ARG_SCHEMAS.SELECT_TRAIN>;
    const conv = p25store.getOrCreate(meta.conversationId);
    const searchRefs = conv.results.filter((r) => r.tool === "SEARCH_TRAINS" && !r.supersededBy && r.items?.length);
    type Row = { index: number; label: string; classes?: string[] };
    type Hit = { row: Row; ref: (typeof searchRefs)[number] };
    const numOf = (label: string) => label.split(" ")[0];
    const nameOf = (label: string) =>
      label.replace(/^\d+\s+/, "").replace(/\s+dep\s.*$/, "").trim();
    // Conservative normalization: case, repeated whitespace, common punctuation.
    const norm = (v: string) =>
      v.toUpperCase().replace(/[.,;:!?'"–—()\[\]{}]/g, " ").replace(/\s+/g, " ").trim();

    const hits: Hit[] = [];
    const missing: string[] = [];

    // Position: 1-based against the NEWEST current result list — the same
    // numbering the UI cards and numbered context items show the user.
    if (a.resultPosition !== undefined) {
      const newest = searchRefs[searchRefs.length - 1];
      const row = newest?.items?.[a.resultPosition - 1];
      if (row) hits.push({ row, ref: newest });
      else missing.push(`position ${a.resultPosition} (the current results hold ${newest?.items?.length ?? 0} trains)`);
    }
    // Number: exact FULL-token match (never prefix/substring/fuzzy), newest first.
    if (a.trainNumber) {
      let found: Hit | null = null;
      for (const ref of [...searchRefs].reverse()) {
        const row = ref.items!.find((i) => i.label === a.trainNumber || i.label.startsWith(`${a.trainNumber} `));
        if (row) {
          found = { row, ref };
          break;
        }
      }
      if (found) hits.push(found);
      else missing.push(`train number ${a.trainNumber}`);
    }
    // Name: normalized match against the full current results; a unique match
    // selects, anything ambiguous asks for clarification — never a guess.
    if (a.trainName) {
      const q = norm(a.trainName);
      let matches: Hit[] = [];
      for (const ref of [...searchRefs].reverse()) {
        for (const row of ref.items!) {
          const n = norm(nameOf(row.label));
          if (n === q || n.includes(q)) matches.push({ row, ref });
        }
      }
      const exact = matches.filter((m) => norm(nameOf(m.row.label)) === q);
      if (exact.length) matches = exact;
      const unique = [...new Map(matches.map((m) => [numOf(m.row.label), m])).values()];
      if (unique.length === 1) hits.push(unique[0]);
      else if (unique.length > 1) {
        return {
          ...baseResult(tool, meta, "error"),
          note: `"${a.trainName}" matches ${unique.length} trains in the current results (${unique
            .slice(0, 4)
            .map((m) => `${numOf(m.row.label)} ${nameOf(m.row.label)}`)
            .join("; ")}${unique.length > 4 ? "; …" : ""}). Nothing was selected — ask the user for the exact train NUMBER they mean.`,
        };
      } else missing.push(`train name "${a.trainName}"`);
    }

    if (missing.length || !hits.length) {
      return {
        ...baseResult(tool, meta, "error"),
        note: `${missing.join(", ") || "The requested train"} is NOT in the current valid search results — nothing was selected. Ask the user to choose from the listed trains, or re-run SEARCH_TRAINS.`,
      };
    }
    // Every supplied identity must point at the SAME train — conflicts are
    // never resolved by silently preferring one field.
    const nums = new Set(hits.map((h) => numOf(h.row.label)));
    if (nums.size > 1) {
      return {
        ...baseResult(tool, meta, "error"),
        note: `The supplied identities conflict — they point at different trains (${[...nums].join(", ")}). Nothing was selected — ask the user to confirm the exact train number.`,
      };
    }
    const hit = hits[0];
    const trainNumber = numOf(hit.row.label); // authoritative identity from the result row
    const trainName = nameOf(hit.row.label) || undefined;
    p25store.setSelection(conv.id, {
      trainNumber,
      trainName,
      from: hit.ref.route?.from,
      to: hit.ref.route?.to,
      journeyDate: hit.ref.journeyDate,
      classes: hit.row.classes,
      selectedAt: new Date().toISOString(),
    });
    return {
      ...baseResult(tool, meta, "ok"),
      note: `Train ${trainNumber}${trainName ? ` (${trainName})` : ""} SELECTED and validated against the current search results; the UI was updated.${
        hit.row.classes?.length ? ` Supported classes: ${hit.row.classes.join(", ")}.` : " Class support could not be verified from provider data."
      } Confirm the selection to the user.`,
      data: { trainNumber, classes: hit.row.classes ?? [] },
    };
  }
  if (tool === "SELECT_CLASS") {
    const a = args as z.infer<typeof TOOL_ARG_SCHEMAS.SELECT_CLASS>;
    const conv = p25store.getOrCreate(meta.conversationId);
    if (!conv.selection) {
      return { ...baseResult(tool, meta, "error"), note: "No train selected yet — select a train first (SELECT_TRAIN)." };
    }
    if (!conv.selection.classes?.length) {
      return { ...baseResult(tool, meta, "error"), note: "Class support cannot be verified for this train (provider returned no class list). Explain honestly; nothing was changed." };
    }
    if (!conv.selection.classes.includes(a.classCode)) {
      return { ...baseResult(tool, meta, "error"), note: `Class ${a.classCode} is NOT supported on train ${conv.selection.trainNumber} per provider data (supported: ${conv.selection.classes.join(", ")}). Nothing was changed — ask the user which supported class they want.` };
    }
    p25store.setSelectionClass(conv.id, a.classCode);
    return {
      ...baseResult(tool, meta, "ok"),
      note: `Class ${a.classCode} selected for train ${conv.selection.trainNumber}. The passenger form is now open — guide the user through the missing passenger details one at a time, per FORM STATE.`,
      data: { classCode: a.classCode },
    };
  }
  if (tool === "UPDATE_PASSENGER") {
    const a = args as z.infer<typeof TOOL_ARG_SCHEMAS.UPDATE_PASSENGER>;
    const v = validatePassengerField(a.field, a.value);
    if (!v.ok) {
      return { ...baseResult(tool, meta, "invalid_arguments"), note: `${v.error} Existing form values were NOT changed — ask again or clarify.` };
    }
    const res = p25store.updatePassenger(meta.conversationId, a.passenger ?? 1, v.patch);
    if (!res.ok) {
      return { ...baseResult(tool, meta, "error"), note: `${res.error} Existing values unchanged.` };
    }
    return {
      ...baseResult(tool, meta, "ok"),
      note: `Passenger ${a.passenger ?? 1} field "${a.field}" validated and saved; the form UI was updated.${a.field === "berth" ? " Berth is recorded as an unverified REQUEST only." : ""} Continue with the next missing required detail, if any.`,
      data: { passengers: res.passengers },
    };
  }

  // 3) Provider invocation with timeout + abort propagation.
  const requestId = `${meta.turnId}:${meta.toolCallId}`;
  const refresh = (args as { refresh?: unknown }).refresh === true;
  const ctx: QueryContext = { locale: "en", requestId, refresh };
  try {
    switch (tool) {
      case "SEARCH_TRAINS": {
        const a = args as z.infer<typeof TOOL_ARG_SCHEMAS.SEARCH_TRAINS>;
        const env = await withTimeout(
          executeCapabilityFailover("trainSearch", (p) => (p as TrainSearchProvider).search(a, ctx), requestId),
          TOOL_TIMEOUT_MS,
          meta.signal,
        );
        return mapEnvelope(tool, meta, env, { journeyDate: a.date });
      }
      case "GET_TRAIN_INFO": {
        const a = args as z.infer<typeof TOOL_ARG_SCHEMAS.GET_TRAIN_INFO>;
        const env = await withTimeout(
          executeCapabilityFailover("trainDetails", (p) => (p as TrainDetailsProvider).details(a.trainNumber, ctx), requestId),
          TOOL_TIMEOUT_MS,
          meta.signal,
        );
        return mapEnvelope(tool, meta, env);
      }
      case "GET_TIMETABLE": {
        const a = args as z.infer<typeof TOOL_ARG_SCHEMAS.GET_TIMETABLE>;
        const env = await withTimeout(
          executeCapabilityFailover("timetable", (p) => (p as TimetableProvider).timetable(a.trainNumber, a.date, ctx), requestId),
          TOOL_TIMEOUT_MS,
          meta.signal,
        );
        return mapEnvelope(tool, meta, env, { journeyDate: a.date });
      }
      case "TRACK_TRAIN": {
        const a = args as z.infer<typeof TOOL_ARG_SCHEMAS.TRACK_TRAIN>;
        const env = await withTimeout(
          executeCapabilityFailover("liveStatus", (p) => (p as LiveStatusProvider).liveStatus(a.trainNumber, a.date, ctx), requestId),
          TOOL_TIMEOUT_MS,
          meta.signal,
        );
        return mapEnvelope(tool, meta, env, { journeyDate: a.date });
      }
      case "CHECK_AVAILABILITY": {
        const a = args as z.infer<typeof TOOL_ARG_SCHEMAS.CHECK_AVAILABILITY>;
        const env = await withTimeout(
          executeCapabilityFailover(
            "seatAvailability",
            (p) =>
              (p as SeatAvailabilityProvider).availability(
                { trainId: a.trainNumber, date: a.date, from: a.from, to: a.to, classCode: a.classCode },
                ctx,
              ),
            requestId,
          ),
          TOOL_TIMEOUT_MS,
          meta.signal,
        );
        return mapEnvelope(tool, meta, env, { journeyDate: a.date, classCode: a.classCode });
      }
      case "GET_FARE": {
        const a = args as z.infer<typeof TOOL_ARG_SCHEMAS.GET_FARE>;
        const env = await withTimeout(
          executeCapabilityFailover(
            "fare",
            (p) =>
              (p as FareProvider).fare(
                { trainId: a.trainNumber, from: a.from, to: a.to, classCode: a.classCode, quota: a.quota, date: a.date },
                ctx,
              ),
            requestId,
          ),
          TOOL_TIMEOUT_MS,
          meta.signal,
        );
        return mapEnvelope(tool, meta, env, { classCode: a.classCode });
      }
      case "CHECK_PNR": {
        const a = args as z.infer<typeof TOOL_ARG_SCHEMAS.CHECK_PNR>;
        const env = await withTimeout(
          executeCapabilityFailover("pnr", (p) => (p as PnrProvider).pnr(a.pnr, ctx), requestId),
          TOOL_TIMEOUT_MS,
          meta.signal,
        );
        return mapEnvelope(tool, meta, env);
      }
      case "GET_CANCELLED_TRAINS": {
        const a = args as z.infer<typeof TOOL_ARG_SCHEMAS.GET_CANCELLED_TRAINS>;
        const env = await withTimeout(
          executeCapabilityFailover("cancellations", (p) => (p as CancellationsProvider).cancellations(a, ctx), requestId),
          TOOL_TIMEOUT_MS,
          meta.signal,
        );
        return mapEnvelope(tool, meta, env, { journeyDate: a.date });
      }
      default: {
        const exhaustive: never = tool;
        return baseResult(exhaustive as string, meta, "error", "Unknown tool.");
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "ABORTED") throw error;
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = message.startsWith("TOOL_TIMEOUT");
    logger.warn("tool execution failed", { tool, correlationId: `${meta.turnId}:${meta.toolCallId}`, error: message });
    return {
      ...baseResult(tool, meta, timedOut ? "timeout" : "error"),
      errors: [{ code: timedOut ? "TIMEOUT" : "UPSTREAM_ERROR", message, retryable: true }],
    };
  }
}
