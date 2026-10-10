export interface TrainCard {
  trainNumber: string;
  trainName: string;
  from: string;
  to: string;
  departure: string;
  arrival: string;
}

/** Deterministic rendering of structured tool data (UI display only —
 *  no interpretation). Data always originates from provider results. */
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
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-navy-600">
            <span>
              {c.from}
              {c.departure ? ` · ${c.departure}` : ""}
            </span>
            <span aria-hidden className="text-navy-300">
              →
            </span>
            <span className="text-right">
              {c.to}
              {c.arrival ? ` · ${c.arrival}` : ""}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
