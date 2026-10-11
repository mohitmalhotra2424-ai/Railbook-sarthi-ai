import Link from "next/link";
import { BrandMark } from "./icons";
import { availabilityKind, KIND_LABEL, KIND_PILL, stationCode } from "./results/status";

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
}

/** Deterministic rendering of structured tool data (UI display only —
 *  no interpretation). Data always originates from provider results.
 *  Fields the provider did not return are labelled "—", never invented. */
export function TrainResultCards({
  cards,
  onAsk,
}: {
  cards: TrainCard[];
  /** Sends a natural-language follow-up through the existing chat turn. */
  onAsk?: (question: string) => void;
}) {
  if (cards.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2.5" data-testid="train-cards">
      {cards.map((c) => {
        const fromCode = stationCode(c.from);
        const toCode = stationCode(c.to);
        return (
          <li
            key={`${c.trainNumber}-${c.departure}`}
            className="overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-sm"
          >
            {/* Header */}
            <div className="flex items-center gap-2.5 border-b border-cream-200 px-3.5 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-700">
                <BrandMark className="h-4.5 w-4.5" />
              </span>
              <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-navy-900">
                {c.trainNumber} · {c.trainName}
              </p>
              {c.journeyDate && (
                <p className="shrink-0 text-[10px] font-semibold text-navy-500" data-testid="card-journey-date">
                  {c.journeyDate}
                </p>
              )}
            </div>

            {/* Journey timeline */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3.5 py-3">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold text-navy-700 [overflow-wrap:anywhere]">
                  {c.from}
                </p>
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
                <p className="truncate text-[11px] font-semibold text-navy-700 [overflow-wrap:anywhere]">
                  {c.to}
                </p>
                <p className="text-lg leading-tight font-bold text-navy-900 tabular-nums" data-testid="card-arr">
                  {c.arrival || "—"}
                </p>
              </div>
            </div>

            {/* Class / availability details */}
            {c.availability && c.availability.length > 0 ? (
              <ul className="space-y-1 border-t border-cream-200 px-3.5 py-2.5" data-testid="card-classes">
                {c.availability.map((a) => {
                  const kind = availabilityKind(a.status);
                  return (
                    <li key={a.classCode} className="flex items-center gap-2 text-[11px]">
                      <span className="w-8 shrink-0 rounded-md bg-navy-50 px-1.5 py-0.5 text-center font-bold text-navy-700">
                        {a.classCode}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 font-semibold ${KIND_PILL[kind]}`}>
                        {KIND_LABEL[kind]}
                      </span>
                      <span className="min-w-0 truncate font-medium text-navy-700">{a.status}</span>
                    </li>
                  );
                })}
              </ul>
            ) : c.classes && c.classes.length > 0 ? (
              <div className="flex flex-wrap gap-1 border-t border-cream-200 px-3.5 py-2.5" data-testid="card-classes">
                {c.classes.map((cls) => (
                  <span
                    key={cls}
                    className="rounded-md bg-navy-50 px-2 py-0.5 text-[10px] font-semibold text-navy-700"
                  >
                    {cls}
                  </span>
                ))}
              </div>
            ) : null}

            {/* Actions — view/ask only; booking stays disabled */}
            <div className="flex gap-2 border-t border-cream-200 bg-cream-100 px-3.5 py-2.5">
              <Link
                href={`/trains/${c.trainNumber}`}
                className="flex-1 rounded-lg border border-navy-200 bg-white px-3 py-2 text-center text-[11px] font-bold text-navy-800 transition hover:border-navy-400"
              >
                View Details
              </Link>
              {onAsk && (
                <button
                  type="button"
                  onClick={() =>
                    onAsk(
                      `${c.trainNumber} ${fromCode || c.from} se ${toCode || c.to} seat availability${
                        c.journeyDate ? ` (${c.journeyDate})` : ""
                      }?`,
                    )
                  }
                  className="flex-1 rounded-lg bg-navy-800 px-3 py-2 text-[11px] font-bold text-white transition hover:bg-navy-700"
                >
                  Check Availability
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
