import type { ResultBlock } from "@/assistant/orchestrator";
import { BrandMark } from "./icons";
import { availabilityKind, inr, KIND_LABEL, KIND_PILL } from "./results/status";

function fmtWhen(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Provenance footer — source + last updated, only when actually provided. */
function Meta({ block }: { block: ResultBlock }) {
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-cream-200 bg-cream-100 px-3.5 py-2 text-[10px] font-medium text-navy-500">
      {block.source ? <span>Source: {block.source}</span> : null}
      {block.freshness ? <span>· {block.freshness}</span> : null}
      {block.retrievedAt ? <span>· Last updated: {fmtWhen(block.retrievedAt)}</span> : null}
      {block.providerTimestamp === null ? (
        <span className="w-full text-navy-400">Provider timestamp unavailable — freshness cannot be verified.</span>
      ) : block.providerTimestamp ? (
        <span>· Provider timestamp: {block.providerTimestamp}</span>
      ) : null}
    </p>
  );
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
  return <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${color}`} />;
}

function Frame({ title, block, children }: { title: string; block: ResultBlock; children: React.ReactNode }) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-sm">
      <p className="border-b border-cream-200 px-3.5 py-2 text-[10px] font-bold tracking-wide text-navy-500 uppercase">
        {title}
      </p>
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
              <Frame key={i} title="Seat Availability" block={b}>
                <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-700">
                    <BrandMark className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0 text-[11px] leading-snug text-navy-600">
                    <p className="truncate font-bold text-navy-900">
                      {d.trainNumber} · {d.from.name} ({d.from.code}) → {d.to.name} ({d.to.code})
                    </p>
                    <p>{d.date}</p>
                  </div>
                </div>
                <div className="grid grid-cols-[3.5rem_1fr_auto] gap-2 border-t border-cream-200 px-3.5 py-1.5 text-[10px] font-bold tracking-wide text-navy-400 uppercase">
                  <span>Class</span>
                  <span>Availability</span>
                  <span>Status</span>
                </div>
                <ul className="px-3.5 pb-3">
                  {d.classes.map((c) => {
                    const kind = availabilityKind(c.status);
                    return (
                      <li
                        key={c.classCode}
                        className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2 border-t border-cream-200 py-1.5 text-[12px]"
                      >
                        <span className="font-bold text-navy-900">{c.classCode}</span>
                        <span className="min-w-0 truncate font-medium text-navy-700">{c.status}</span>
                        <span className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${KIND_PILL[kind]}`}>
                          <Dot kind={kind} />
                          {KIND_LABEL[kind]}
                        </span>
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
              <Frame key={i} title="Fare Information" block={b}>
                <div className="px-3.5 py-2.5 text-[11px] leading-snug text-navy-600">
                  <p className="font-bold text-navy-900">
                    {d.trainNumber} · {d.from.name} ({d.from.code}) → {d.to.name} ({d.to.code})
                  </p>
                </div>
                <div className="grid grid-cols-[3.5rem_1fr] gap-2 border-t border-cream-200 px-3.5 py-1.5 text-[10px] font-bold tracking-wide text-navy-400 uppercase">
                  <span>Class</span>
                  <span className="text-right">Fare (₹)</span>
                </div>
                <ul className="px-3.5 pb-2">
                  <li className="grid grid-cols-[3.5rem_1fr] items-center gap-2 border-t border-cream-200 py-1.5 text-[12px]">
                    <span className="font-bold text-navy-900">{d.classCode}</span>
                    <span className="text-right font-bold text-navy-900 tabular-nums">{inr(d.totalFare)}</span>
                  </li>
                </ul>
                {d.breakup && d.breakup.length > 0 && (
                  <ul className="space-y-0.5 border-t border-cream-200 px-3.5 py-2 text-[10px] text-navy-500">
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
              <Frame key={i} title="Live Train Status" block={b}>
                <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                  <p className="min-w-0 truncate text-[12px] font-bold text-navy-900">
                    {d.trainNumber} · {d.trainName}
                  </p>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      d.running === null
                        ? "border-navy-200 bg-navy-50 text-navy-600"
                        : d.running
                          ? "border-signal-500/40 bg-signal-500/10 text-signal-700"
                          : "border-alert-500/40 bg-alert-500/10 text-alert-500"
                    }`}
                  >
                    {d.running === null ? "Not reported" : d.running ? "Running" : "Not running"}
                  </span>
                </div>
                <ul className="space-y-1 border-t border-cream-200 px-3.5 py-2.5 text-[11px] text-navy-800">
                  <li className="flex justify-between gap-3">
                    <span className="text-navy-500">Current / last location</span>
                    <span className="text-right font-semibold">
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
              <Frame key={i} title="PNR Status" block={b}>
                <div className="px-3.5 py-2.5 text-[11px] leading-snug text-navy-600">
                  <p className="font-bold text-navy-900">
                    {d.pnr}
                    {d.trainName ? ` · ${d.trainName}` : ""}
                    {d.trainNumber ? ` (${d.trainNumber})` : ""}
                  </p>
                  <p>
                    Journey: {d.journeyDate ?? "not reported"} · Chart prepared: {d.chartPrepared ? "Yes" : "No"}
                  </p>
                </div>
                <ul className="px-3.5 pb-3">
                  {d.passengers.map((p) => {
                    const kind = availabilityKind(p.currentStatus);
                    return (
                      <li
                        key={p.passengerNumber}
                        className="flex flex-wrap items-center gap-2 border-t border-cream-200 py-1.5 text-[11px]"
                      >
                        <span className="font-bold text-navy-900">P{p.passengerNumber}</span>
                        <span className="text-navy-500">booking: {p.bookingStatus}</span>
                        <span className={`ml-auto flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-semibold ${KIND_PILL[kind]}`}>
                          <Dot kind={kind} />
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
