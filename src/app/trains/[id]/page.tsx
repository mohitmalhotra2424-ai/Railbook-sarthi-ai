import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnvelopePanel } from "@/components/EnvelopePanel";
import type { LiveStatus, Timetable, TrainDetails } from "@/domain/schemas";
import { makeRequestId } from "@/lib/http";
import { executeCapability } from "@/providers/registry";
import type {
  LiveStatusProvider,
  QueryContext,
  TimetableProvider,
  TrainDetailsProvider,
} from "@/providers/types";

export const metadata: Metadata = { title: "Train" };

/** Live-data page: always render at request time (requestId, retrievedAt, freshness). */
export const dynamic = "force-dynamic";

export default async function TrainDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const trainId = id.trim();
  if (!/^\d{4,6}$/.test(trainId)) notFound();

  const requestId = makeRequestId();
  const ctx: QueryContext = { locale: "en", requestId };
  const today = new Date().toISOString().slice(0, 10);

  const [details, timetable, live] = await Promise.all([
    executeCapability<TrainDetails>(
      "trainDetails",
      (p) => (p as TrainDetailsProvider).details(trainId, ctx),
      requestId,
    ),
    executeCapability<Timetable>(
      "timetable",
      (p) => (p as TimetableProvider).timetable(trainId, today, ctx),
      requestId,
    ),
    executeCapability<LiveStatus>(
      "liveStatus",
      (p) => (p as LiveStatusProvider).liveStatus(trainId, today, ctx),
      requestId,
    ),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-navy-900">
          Train {trainId} <span className="text-navy-400">· ट्रेन विवरण</span>
        </h1>
        <p className="mt-0.5 text-xs text-navy-600">
          Details, timetable and live status — each with its own source and freshness.
        </p>
      </header>

      <EnvelopePanel
        title="Details"
        envelope={details}
        renderData={(d) => (
          <div className="text-sm text-navy-900">
            <p className="font-semibold">
              {d.trainNumber} — {d.trainName}
            </p>
            <p className="mt-0.5 text-xs text-navy-600">
              {d.from.name} ({d.from.code}) → {d.to.name} ({d.to.code}) · dep {d.departure} · arr{" "}
              {d.arrival}
            </p>
          </div>
        )}
      />

      <EnvelopePanel
        title="Timetable"
        envelope={timetable}
        renderData={(t) => (
          <ol className="space-y-1 text-sm text-navy-900">
            {t.entries.map((e) => (
              <li key={e.sequence} className="flex justify-between gap-3 border-b border-cream-200 pb-1">
                <span>
                  {e.station.name} <span className="text-navy-400">({e.station.code})</span>
                </span>
                <span className="font-mono text-xs">
                  arr {e.arrival ?? "—"} · dep {e.departure ?? "—"}
                </span>
              </li>
            ))}
          </ol>
        )}
      />

      <EnvelopePanel
        title="Live status"
        envelope={live}
        renderData={(s) => (
          <div className="text-sm text-navy-900">
            <p>
              Running: <strong>{s.running === null ? "unknown" : String(s.running)}</strong>
            </p>
            <p className="text-xs text-navy-600">
              Last station: {s.lastStation ? `${s.lastStation.name} (${s.lastStation.code})` : "unknown"}{" "}
              · Delay: {s.delayMinutes === null ? "unknown" : `${s.delayMinutes} min`}
            </p>
          </div>
        )}
      />
    </div>
  );
}
