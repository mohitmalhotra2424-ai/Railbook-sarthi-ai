import Link from "next/link";
import { useState } from "react";
import { ChevronDownIcon } from "./icons";
import { availabilityKind, KIND_LABEL, stationCode } from "./results/status";
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
    <li
      className={`overflow-hidden bg-white shadow-sm ${
        selected ? "rounded-2xl border-2 border-navy-900" : "rounded-2xl border border-cream-300"
      }`}
    >
      {/* Header — number + name | selected pill (reference layout) */}
      <div className="flex items-start justify-between gap-2 px-4 pt-3.5">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-navy-700 tabular-nums">{c.trainNumber}</p>
          <p className="truncate text-[15px] font-extrabold text-navy-900">{c.trainName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          {selected && (
            <span
              data-testid="card-selected"
              className="flex items-center gap-1 rounded-full bg-cream-200 px-2.5 py-1 text-[10px] font-bold text-navy-800"
            >
              <CheckIcon className="h-2.5 w-2.5" /> Selected
            </span>
          )}
          {c.journeyDate && (
            <span className="text-[10px] font-semibold text-navy-500" data-testid="card-journey-date">
              {c.journeyDate}
            </span>
          )}
        </div>
      </div>

      {/* Times + route line */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pt-2 pb-3">
        <div className="min-w-0">
          <p className="text-[22px] leading-tight font-extrabold text-navy-900 tabular-nums" data-testid="card-dep">
            {c.departure || "—"}
          </p>
          <p className="mt-0.5 truncate text-[11px] font-medium text-navy-500 [overflow-wrap:anywhere]">{c.from}</p>
        </div>
        <div aria-hidden className="flex items-center self-center px-1 pb-4">
          <span className="flex w-16 items-center sm:w-24">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-navy-700 bg-white" />
            <span className="flex-1 border-t-2 border-navy-200" />
            <span className="h-2.5 w-2.5 rounded-full bg-navy-800" />
          </span>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-[22px] leading-tight font-extrabold text-navy-900 tabular-nums" data-testid="card-arr">
            {c.arrival || "—"}
          </p>
          <p className="mt-0.5 truncate text-[11px] font-medium text-navy-500 [overflow-wrap:anywhere]">{c.to}</p>
        </div>
      </div>

      {/* Class boxes — code + exact provider availability (no invention) */}
      {chipClasses.length > 0 && (
        <div className="px-4 pb-3">
          <div
            role="group"
            aria-label={`Travel classes for train ${c.trainNumber}`}
            className="flex flex-wrap gap-2"
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
                  className={`min-w-[86px] rounded-xl px-3 py-2 text-left transition disabled:opacity-50 ${
                    isSelected ? "border-2 border-navy-900 bg-white" : "border border-cream-300 bg-cream-50 hover:border-navy-400"
                  }`}
                >
                  <span className="block text-[12px] font-extrabold text-navy-900">{cls}</span>
                  {isLoading ? (
                    <span className="block animate-pulse text-[10px] font-semibold text-navy-500">…</span>
                  ) : av ? (
                    <span className="block text-[10px] font-bold text-saffron-600">{av.status}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Provenance strip — only facts the pipeline actually has */}
      {(c.source || c.retrievedAt) && (
        <p className="border-t border-cream-200 px-4 py-1.5 text-[9px] font-medium text-navy-400">
          {c.source ? `Source: ${c.source}` : ""}
          {c.retrievedAt ? ` · retrieved ${new Date(c.retrievedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}
          {c.providerTimestamp === null
            ? " · provider timestamp unavailable"
            : c.providerTimestamp
              ? ` · provider: ${c.providerTimestamp}`
              : ""}
        </p>
      )}

      {/* Actions — primary select CTA; details link; real enquiries stay secondary */}
      <div className="flex flex-wrap items-center gap-2.5 border-t border-cream-200 bg-cream-50 px-4 py-3">
        {onAsk && (
          <button
            type="button"
            data-testid="card-select-train"
            disabled={busy || selected}
            onClick={() => onAsk(`${c.trainNumber} select karo`)}
            className={`rounded-xl px-4 py-2.5 text-[12px] font-bold transition ${
              selected ? "bg-signal-500/10 text-signal-700" : "bg-navy-900 text-white hover:bg-navy-800 disabled:opacity-60"
            }`}
          >
            {selected ? "Selected ✓" : "Select train"}
          </button>
        )}
        <Link
          href={`/trains/${c.trainNumber}`}
          className="flex items-center gap-1 text-[12px] font-bold text-navy-800 transition hover:text-navy-600"
        >
          Details <ChevronDownIcon className="h-3 w-3" />
        </Link>
        {onAsk && (
          <div className="ml-auto flex gap-1.5">
            <button
              type="button"
              data-testid={pendingAction === "availability" ? "card-availability-loading" : undefined}
              disabled={busy || pendingAction !== null}
              aria-busy={pendingAction === "availability"}
              onClick={() => askOnce("availability", availabilityQuestion(selectedClass ?? undefined))}
              className="rounded-full border border-navy-200 bg-white px-3 py-1.5 text-[10px] font-bold text-navy-800 transition hover:border-navy-400 disabled:opacity-50"
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
              className="rounded-full border border-navy-200 bg-white px-3 py-1.5 text-[10px] font-bold text-navy-800 transition hover:border-navy-400 disabled:opacity-50"
            >
              {pendingAction === "fare" ? "Checking fare…" : "Check Fare"}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
