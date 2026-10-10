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
          className="rounded-2xl border border-cream-300 bg-white p-3 shadow-sm"
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-navy-900">
              {c.trainNumber} · {c.trainName}
            </p>
            {c.journeyDate && (
              <p className="shrink-0 text-[10px] font-medium text-navy-500" data-testid="card-journey-date">
                {c.journeyDate}
              </p>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-navy-600">
            <span>
              {c.from}
              <span className="ml-1 font-semibold text-navy-800" data-testid="card-dep">
                {c.departure || "—"}
              </span>
            </span>
            <span aria-hidden className="text-navy-300">
              →
            </span>
            <span className="text-right">
              {c.to}
              <span className="ml-1 font-semibold text-navy-800" data-testid="card-arr">
                {c.arrival || "—"}
              </span>
            </span>
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
