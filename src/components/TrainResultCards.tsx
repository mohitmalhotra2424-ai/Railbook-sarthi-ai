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
}

/** Deterministic rendering of structured tool data (UI display only —
 *  no interpretation). Data always originates from provider results.
 *  Fields the provider did not return are labelled "—", never invented. */
export function TrainResultCards({ cards }: { cards: TrainCard[] }) {
  if (cards.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2" data-testid="train-cards">
      {cards.map((c) => (
        <li
          key={`${c.trainNumber}-${c.departure}`}
          className="rounded-xl border border-cream-300 bg-cream-50 p-3"
        >
          {/* Identity row */}
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-[13px] font-bold text-navy-900">
              {c.trainNumber} · {c.trainName}
            </p>
            {c.journeyDate && (
              <p className="shrink-0 text-[10px] font-semibold text-navy-500" data-testid="card-journey-date">
                {c.journeyDate}
              </p>
            )}
          </div>

          {/* Journey row: times dominate, stations secondary */}
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div className="min-w-0">
              <p className="text-base font-bold text-navy-900 tabular-nums" data-testid="card-dep">
                {c.departure || "—"}
              </p>
              <p className="truncate text-[11px] text-navy-600">{c.from}</p>
            </div>
            <div aria-hidden className="flex flex-col items-center px-1">
              <span className="h-1.5 w-1.5 rounded-full bg-navy-300" />
              <span className="my-0.5 h-px w-10 bg-navy-200 sm:w-14" />
              <span className="h-1.5 w-1.5 rounded-full bg-saffron-500" />
            </div>
            <div className="min-w-0 text-right">
              <p className="text-base font-bold text-navy-900 tabular-nums" data-testid="card-arr">
                {c.arrival || "—"}
              </p>
              <p className="truncate text-[11px] text-navy-600">{c.to}</p>
            </div>
          </div>

          {c.classes && c.classes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1" data-testid="card-classes">
              {c.classes.map((cls) => (
                <span
                  key={cls}
                  className="rounded-md bg-navy-50 px-1.5 py-0.5 text-[10px] font-semibold text-navy-700"
                >
                  {cls}
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
