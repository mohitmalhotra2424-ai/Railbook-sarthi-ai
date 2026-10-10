import type { ResultBlock } from "@/assistant/orchestrator";
import { availabilityKind, inr, KIND_LABEL, KIND_PILL } from "./results/status";

/** Small provenance line: source + freshness + retrieval time (never hidden). */
function Meta({ block }: { block: ResultBlock }) {
  return (
    <p className="mt-2.5 text-[10px] text-navy-400">
      {block.source ? `source: ${block.source}` : "source: —"}
      {block.freshness ? ` · ${block.freshness}` : ""}
      {block.retrievedAt ? ` · ${new Date(block.retrievedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : ""}
    </p>
  );
}

function Frame({ title, block, children }: { title: string; block: ResultBlock; children: React.ReactNode }) {
  return (
    <div className="mt-2.5 rounded-2xl border border-cream-300 bg-cream-50 p-3.5">
      <p className="text-[11px] font-bold tracking-wide text-navy-500 uppercase">{title}</p>
      {children}
      <Meta block={block} />
    </div>
  );
}

export function ResultBlocks({ blocks }: { blocks: ResultBlock[] }) {
  if (blocks.length === 0) return null;
  return (
    <div data-testid="result-blocks">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "availability": {
            const d = b.data;
            return (
              <Frame key={i} title="Seat availability" block={b}>
                <p className="mt-1 text-[13px] font-bold text-navy-900">
                  {d.trainNumber} · {d.from.name} ({d.from.code}) → {d.to.name} ({d.to.code})
                </p>
                <p className="mt-0.5 text-[11px] text-navy-600">Journey date: {d.date}</p>
                <ul className="mt-2 space-y-1">
                  {d.classes.map((c) => {
                    const kind = availabilityKind(c.status);
                    return (
                      <li key={c.classCode} className="flex items-center gap-2 text-[11px]">
                        <span className="w-8 shrink-0 rounded-md bg-navy-50 px-1.5 py-0.5 text-center font-bold text-navy-700">
                          {c.classCode}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 font-semibold ${KIND_PILL[kind]}`}>
                          {KIND_LABEL[kind]}
                        </span>
                        <span className="min-w-0 truncate font-medium text-navy-700">{c.status}</span>
                        {c.asOf ? <span className="ml-auto shrink-0 text-[10px] text-navy-400">as of {c.asOf}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              </Frame>
            );
          }
          case "fare": {
            const d = b.data;
            return (
              <Frame key={i} title="Fare" block={b}>
                <p className="mt-1 text-[13px] font-bold text-navy-900">
                  {d.trainNumber} · class {d.classCode} · {d.from.name} ({d.from.code}) → {d.to.name} ({d.to.code})
                </p>
                <div className="mt-2 flex items-baseline gap-4 text-sm">
                  <p className="text-navy-700">
                    <span className="text-[11px] font-semibold text-navy-500">Total </span>
                    <span className="text-base font-bold text-navy-900 tabular-nums">{inr(d.totalFare)}</span>
                  </p>
                  <p className="text-navy-700">
                    <span className="text-[11px] font-semibold text-navy-500">Base </span>
                    <span className="font-semibold tabular-nums">{inr(d.baseFare)}</span>
                  </p>
                </div>
                {d.breakup && d.breakup.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-[11px] text-navy-600">
                    {d.breakup.map((x) => (
                      <li key={x.component} className="flex justify-between gap-3">
                        <span>{x.component}</span>
                        <span className="tabular-nums">{inr(x.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Frame>
            );
          }
          case "live": {
            const d = b.data;
            return (
              <Frame key={i} title="Live status" block={b}>
                <p className="mt-1 text-[13px] font-bold text-navy-900">
                  {d.trainNumber} · {d.trainName}
                </p>
                <ul className="mt-2 space-y-1 text-[12px] text-navy-800">
                  <li className="flex justify-between gap-3">
                    <span className="text-navy-500">Running</span>
                    <span className="font-semibold">
                      {d.running === null ? "Not reported" : d.running ? "Yes" : "No"}
                    </span>
                  </li>
                  <li className="flex justify-between gap-3">
                    <span className="text-navy-500">Last reported at</span>
                    <span className="font-semibold">
                      {d.lastStation ? `${d.lastStation.name} (${d.lastStation.code})` : "Not reported"}
                    </span>
                  </li>
                  <li className="flex justify-between gap-3">
                    <span className="text-navy-500">Delay</span>
                    <span className="font-semibold">
                      {d.delayMinutes === null
                        ? "Not reported"
                        : d.delayMinutes === 0
                          ? "On time"
                          : `Late by ${d.delayMinutes} min`}
                    </span>
                  </li>
                  {d.updatedAt && (
                    <li className="flex justify-between gap-3">
                      <span className="text-navy-500">Updated</span>
                      <span className="font-semibold">{d.updatedAt}</span>
                    </li>
                  )}
                </ul>
              </Frame>
            );
          }
          case "pnr": {
            const d = b.data;
            return (
              <Frame key={i} title="PNR status" block={b}>
                <p className="mt-1 text-[13px] font-bold text-navy-900">
                  {d.pnr}
                  {d.trainName ? ` · ${d.trainName}` : ""}
                  {d.trainNumber ? ` (${d.trainNumber})` : ""}
                </p>
                <p className="mt-0.5 text-[11px] text-navy-600">
                  Journey: {d.journeyDate ?? "not reported"} · Chart prepared: {d.chartPrepared ? "Yes" : "No"}
                </p>
                <ul className="mt-2 space-y-1">
                  {d.passengers.map((p) => {
                    const kind = availabilityKind(p.currentStatus);
                    return (
                      <li key={p.passengerNumber} className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="font-semibold text-navy-700">P{p.passengerNumber}</span>
                        <span className="text-navy-500">booking: {p.bookingStatus}</span>
                        <span className={`rounded-full border px-2 py-0.5 font-semibold ${KIND_PILL[kind]}`}>
                          {KIND_LABEL[kind]}
                        </span>
                        <span className="font-medium text-navy-700">{p.currentStatus}</span>
                      </li>
                    );
                  })}
                </ul>
              </Frame>
            );
          }
        }
      })}
    </div>
  );
}
