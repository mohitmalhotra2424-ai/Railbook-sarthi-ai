import Link from "next/link";
import { useState } from "react";
import { BrandMark } from "./icons";
import { availabilityKind, KIND_LABEL, KIND_PILL, stationCode } from "./results/status";
import { CheckIcon } from "./icons";

export interface TrainCard {
  trainNumber: string;
  trainName: string;
  from: string;
  to: string;
  departure: string;
  arrival: string;
  /** Only when the provider returned classes for this train. */
  classes?: string[];
  /** Journey date of the search these cards came from. */
  journeyDate?: string;
  /** Per-class availability only when the provider published it. */
  availability?: { classCode: string; status: string; asOf?: string | null }[];
  /** Provenance: provider id + our retrieval time (+ provider ts when given). */
  source?: string;
  retrievedAt?: string;
  providerTimestamp?: string | null;
}

function Dot({ kind }: { kind: ReturnType<typeof availabilityKind> }) {
  const color =
    kind === "available"
      ? "bg-signal-500"
      : kind === "rac"
        ? "bg-saffron-500"
        : kind === "unknown"
          ? "bg-navy-300"
          : "bg-alert-500";
  return <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />;
}

/** Deterministic rendering of structured tool data (UI display only —
 *  no interpretation). Data always originates from provider results.
 *  Fields the provider did not return are labelled "—", never invented.
 *
 *  Button-behavior contract:
 *  - Class chips  → DEFAULT / SELECTED / LOADING / DISABLED. Tapping a class
 *    selects it for follow-up enquiries AND (when that class has no returned
 *    availability) fires a real availability enquiry through the existing
 *    chat turn — loading tracks the actual turn (busy prop), never a fake
 *    timer. Selection is honoured by Check Fare / Check Availability.
 *  - View Details → real /trains/:id route; opens details, no new search,
 *    no accidental selection; conversation is preserved.
 *  - Check Availability (primary) / Check Fare (secondary) → one follow-up
 *    through the EXISTING chat turn; visible loading + duplicate protection.
 *  No success is simulated — the real assistant answer (or error) follows. */
export function TrainResultCards({
  cards,
  onAsk,
  busy = false,
  selectedTrainNumber = null,
}: {
  cards: TrainCard[];
  /** Sends a natural-language follow-up through the existing chat turn. */
  onAsk?: (question: string) => void;
  /** True while a chat turn is in flight — drives chip/button loading states. */
  busy?: boolean;
  /** Prompt 25: backend-validated selection, mirrored in the UI. */
  selectedTrainNumber?: string | null;
}) {
  if (cards.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2.5" data-testid="train-cards">
      {cards.map((c) => (
        <TrainCardView
          key={`${c.trainNumber}-${c.departure}`}
          c={c}
          onAsk={onAsk}
          busy={busy}
          selected={selectedTrainNumber === c.trainNumber}
        />
      ))}
    </ul>
  );
}

function TrainCardView({
  c,
  onAsk,
  busy,
  selected,
}: {
  c: TrainCard;
  onAsk?: (q: string) => void;
  busy: boolean;
  selected: boolean;
}) {
  const [pendingActionRaw, setPendingAction] = useState<null | "availability" | "fare">(null);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [pendingClassRaw, setPendingClass] = useState<string | null>(null);

  // Loading states track the REAL turn: when the chat is no longer busy the
  // in-flight marker clears (result or error will be visible in the thread).
  const pendingAction = busy ? pendingActionRaw : null;
  const pendingClass = busy ? pendingClassRaw : null;

  const fromCode = stationCode(c.from);
  const toCode = stationCode(c.to);
  const fareClass = selectedClass ?? c.classes?.[0];

  const askOnce = (which: "availability" | "fare", question: string) => {
    if (busy || pendingAction || !onAsk) return; // duplicate-click protection
    setPendingAction(which);
    onAsk(question);
  };

  const availabilityQuestion = (cls?: string) =>
    `${c.trainNumber} ${fromCode || c.from} se ${toCode || c.to} ${cls ? `${cls} ` : ""}seat availability${
      c.journeyDate ? ` (${c.journeyDate})` : ""
    }?`;

  /** Class chip tap: select for follow-ups; if this class has no returned
   *  availability yet, run a real enquiry through the existing turn. */
  const onClassTap = (cls: string) => {
    if (busy) return;
    setSelectedClass(cls);
    const has = c.availability?.some((a) => a.classCode === cls);
    if (!has && onAsk) {
      setPendingClass(cls);
      onAsk(availabilityQuestion(cls));
    }
  };

  // Chips come only from the authoritative result (classes ∪ returned availability).
  const chipClasses = [
    ...(c.classes ?? []),
    ...(c.availability ?? []).map((a) => a.classCode).filter((x) => !(c.classes ?? []).includes(x)),
  ];

  return (
    <li className="overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-cream-200 px-3.5 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-700">
          <BrandMark className="h-4.5 w-4.5" />
        </span>
        <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-navy-900">
          {c.trainNumber} · {c.trainName}
        </p>
        {selected && (
          <span
            data-testid="card-selected"
            className="flex shrink-0 items-center gap-1 rounded-full bg-signal-500/10 px-2 py-0.5 text-[9px] font-bold text-signal-700"
          >
            <CheckIcon className="h-2.5 w-2.5" /> Selected
          </span>
        )}
        {c.journeyDate && (
          <p className="shrink-0 text-[10px] font-semibold text-navy-500" data-testid="card-journey-date">
            {c.journeyDate}
          </p>
        )}
      </div>

      {/* Journey timeline */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3.5 py-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-navy-700 [overflow-wrap:anywhere]">{c.from}</p>
          <p className="text-lg leading-tight font-bold text-navy-900 tabular-nums" data-testid="card-dep">
            {c.departure || "—"}
          </p>
        </div>
        <div aria-hidden className="flex flex-col items-center self-center px-1">
          <span className="flex items-center">
            <span className="h-1.5 w-1.5 rounded-full bg-navy-400" />
            <span className="mx-0.5 w-8 border-t-2 border-dotted border-navy-200 sm:w-14" />
            <span className="h-1.5 w-1.5 rounded-full bg-saffron-500" />
          </span>
        </div>
        <div className="min-w-0 text-right">
          <p className="truncate text-[11px] font-semibold text-navy-700 [overflow-wrap:anywhere]">{c.to}</p>
          <p className="text-lg leading-tight font-bold text-navy-900 tabular-nums" data-testid="card-arr">
            {c.arrival || "—"}
          </p>
        </div>
      </div>

      {/* Class chips (interactive) + availability association */}
      {chipClasses.length > 0 && (
        <div className="border-t border-cream-200 px-3.5 py-2.5">
          <div
            role="group"
            aria-label={`Travel classes for train ${c.trainNumber}`}
            className="flex flex-wrap gap-1.5"
            data-testid="card-classes"
          >
            {chipClasses.map((cls) => {
              const av = c.availability?.find((a) => a.classCode === cls);
              const kind = av ? availabilityKind(av.status) : null;
              const isSelected = selectedClass === cls;
              const isLoading = pendingClass === cls && busy;
              return (
                <button
                  key={cls}
                  type="button"
                  data-testid={`class-chip-${cls}`}
                  aria-pressed={isSelected}
                  aria-label={
                    kind
                      ? `Class ${cls}, ${KIND_LABEL[kind]}${isSelected ? ", selected" : ""}`
                      : `Class ${cls}${isSelected ? ", selected" : ""}`
                  }
                  disabled={busy}
                  onClick={() => onClassTap(cls)}
                  className={`flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition disabled:opacity-50 ${
                    isSelected
                      ? "border-navy-800 bg-navy-800 text-white"
                      : "border-cream-300 bg-white text-navy-800 hover:border-navy-400"
                  }`}
                >
                  {cls}
                  {isLoading ? (
                    <span aria-hidden className="animate-pulse text-[10px] font-semibold">…</span>
                  ) : kind ? (
                    <>
                      <Dot kind={kind} />
                      <span className={isSelected ? "text-white" : KIND_PILL[kind]}>{KIND_LABEL[kind]}</span>
                    </>
                  ) : isSelected ? (
                    <span aria-hidden>✓</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {/* Keep the exact provider values attached to train+date+class */}
          {c.availability && c.availability.length > 0 && (
            <p className="mt-1.5 text-[10px] font-medium text-navy-500">
              {c.availability.map((a) => `${a.classCode}: ${a.status}`).join(" · ")}
            </p>
          )}
        </div>
      )}

      {/* Provenance strip — only facts the pipeline actually has */}
      {(c.source || c.retrievedAt) && (
        <p className="border-t border-cream-200 px-3.5 py-1.5 text-[9px] font-medium text-navy-400">
          {c.source ? `Source: ${c.source}` : ""}
          {c.retrievedAt ? ` · retrieved ${new Date(c.retrievedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}
          {c.providerTimestamp === null
            ? " · provider timestamp unavailable"
            : c.providerTimestamp
              ? ` · provider: ${c.providerTimestamp}`
              : ""}
        </p>
      )}

      {/* Actions — one primary, rest secondary; booking stays disabled */}
      <div className="flex flex-wrap gap-1.5 border-t border-cream-200 bg-cream-100 px-3.5 py-2.5">
        <Link
          href={`/trains/${c.trainNumber}`}
          className="min-w-[92px] flex-1 rounded-lg border border-navy-200 bg-white px-3 py-2 text-center text-[11px] font-bold text-navy-800 transition hover:border-navy-400"
        >
          View Details
        </Link>
        {onAsk && (
          <>
            <button
              type="button"
              data-testid={pendingAction === "availability" ? "card-availability-loading" : undefined}
              disabled={busy || pendingAction !== null}
              aria-busy={pendingAction === "availability"}
              onClick={() => askOnce("availability", availabilityQuestion(selectedClass ?? undefined))}
              className="min-w-[92px] flex-1 rounded-lg bg-navy-800 px-3 py-2 text-[11px] font-bold text-white transition hover:bg-navy-700 disabled:opacity-60"
            >
              {pendingAction === "availability" ? "Checking availability…" : "Check Availability"}
            </button>
            <button
              type="button"
              disabled={busy || pendingAction !== null}
              aria-busy={pendingAction === "fare"}
              onClick={() =>
                askOnce(
                  "fare",
                  `${c.trainNumber} ${fromCode || c.from} se ${toCode || c.to} ${
                    fareClass ? `${fareClass} ` : ""
                  }fare kitna hai${c.journeyDate ? ` (${c.journeyDate})` : ""}?`,
                )
              }
              className="min-w-[92px] flex-1 rounded-lg border border-navy-200 bg-navy-50 px-3 py-2 text-[11px] font-bold text-navy-800 transition hover:border-navy-400 disabled:opacity-60"
            >
              {pendingAction === "fare" ? "Checking fare…" : "Check Fare"}
            </button>
          </>
        )}
      </div>
    </li>
  );
}
