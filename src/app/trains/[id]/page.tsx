import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnvelopePanel } from "@/components/EnvelopePanel";
import { NotConfiguredBanner } from "@/components/NotConfiguredBanner";
import { isNotConfigured } from "@/providers/envelope";
import type { LiveStatus, Timetable, TrainDetails, Fare, Availability } from "@/domain/schemas";
import { makeRequestId } from "@/lib/http";
import { executeCapability } from "@/providers/registry";
import type {
  FareProvider,
  LiveStatusProvider,
  QueryContext,
  SeatAvailabilityProvider,
  TimetableProvider,
  TrainDetailsProvider,
} from "@/providers/types";
import { availabilityKind, inr, KIND_LABEL, KIND_PILL } from "@/components/results/status";

export const metadata: Metadata = { title: "Train" };

/** Live-data page: always render at request time (requestId, retrievedAt, freshness). */
export const dynamic = "force-dynamic";

export default async function TrainDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
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

  // Availability + fares need a resolved route; only queried when details exist.
  const route = details.data;
  const availability = route
    ? await executeCapability<Availability>(
        "seatAvailability",
        (p) =>
          (p as SeatAvailabilityProvider).availability(
            { trainId, date: today, from: route.from.code, to: route.to.code },
            ctx,
          ),
        requestId,
      )
    : null;

  const fareClasses = route?.classes?.slice(0, 6) ?? [];
  const fares = route
    ? await Promise.all(
        fareClasses.map((c) =>
          executeCapability<Fare>(
            "fare",
            (p) =>
              (p as FareProvider).fare(
                { trainId, from: route.from.code, to: route.to.code, classCode: c, date: today },
                ctx,
              ),
            requestId,
          ),
        ),
      )
    : [];

  const fareRows = fareClasses
    .map((c, i) => ({ classCode: c, env: fares[i] }))
    .filter((r) => r.env.data !== null);
  const faresNotConfigured = fareClasses.length > 0 && fares.every((f) => isNotConfigured(f));

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-navy-900">
          Train {trainId} <span className="text-navy-400">· ट्रेन विवरण</span>
        </h1>
        <p className="mt-0.5 text-xs text-navy-600">
          Every section shows its own source, retrieval time and freshness.
        </p>
      </header>

      <EnvelopePanel
        title="Journey overview"
        envelope={details}
        renderData={(d) => (
          <div>
            <p className="text-sm font-bold text-navy-900">
              {d.trainNumber} · {d.trainName}
            </p>
            <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="min-w-0">
                <p className="text-lg font-bold text-navy-900 tabular-nums">{d.departure || "—"}</p>
                <p className="text-[11px] text-navy-600 [overflow-wrap:anywhere]">
                  {d.from.name} ({d.from.code})
                </p>
              </div>
              <div aria-hidden className="flex flex-col items-center px-1">
                <span className="h-2 w-2 rounded-full border-2 border-navy-400 bg-white" />
                <span className="my-0.5 h-0.5 w-12 rounded bg-navy-200" />
                <span className="h-2 w-2 rounded-full bg-saffron-500" />
              </div>
              <div className="min-w-0 text-right">
                <p className="text-lg font-bold text-navy-900 tabular-nums">{d.arrival || "—"}</p>
                <p className="text-[11px] text-navy-600 [overflow-wrap:anywhere]">
                  {d.to.name} ({d.to.code})
                </p>
              </div>
            </div>
            {d.classes && d.classes.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1">
                {d.classes.map((c) => (
                  <span key={c} className="rounded-md bg-navy-50 px-1.5 py-0.5 text-[10px] font-semibold text-navy-700">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      />

      {availability && (
        <EnvelopePanel
          title={`Seat availability · ${today}`}
          envelope={availability}
          renderData={(a) => (
            <ul className="space-y-1">
              {a.classes.map((c) => {
                const kind = availabilityKind(c.status);
                return (
                  <li key={c.classCode} className="flex items-center gap-2 text-[12px]">
                    <span className="w-8 shrink-0 rounded-md bg-navy-50 px-1.5 py-0.5 text-center font-bold text-navy-700">
                      {c.classCode}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 font-semibold ${KIND_PILL[kind]}`}>
                      {KIND_LABEL[kind]}
                    </span>
                    <span className="min-w-0 truncate font-medium text-navy-700">{c.status}</span>
                    {c.seatsText && c.seatsText !== c.status ? (
                      <span className="text-[10px] text-navy-400">({c.seatsText})</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        />
      )}

      {route && fareClasses.length > 0 && (
        <section className="rounded-2xl border border-cream-300 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-bold text-navy-900">Fares by class · {today}</h2>
          {faresNotConfigured ? (
            <div className="mt-3">
              <NotConfiguredBanner />
            </div>
          ) : fareRows.length === 0 ? (
            <p className="mt-2 text-xs text-navy-600">No fare data returned for this route.</p>
          ) : (
            <ul className="mt-2.5 space-y-1">
              {fareRows.map((r) => (
                <li key={r.classCode} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="w-8 rounded-md bg-navy-50 px-1.5 py-0.5 text-center font-bold text-navy-700">
                    {r.classCode}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-navy-600">
                    {r.env.data!.from.name} → {r.env.data!.to.name}
                  </span>
                  <span className="font-bold text-navy-900 tabular-nums">{inr(r.env.data!.totalFare)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <EnvelopePanel
        title="Route & timings"
        envelope={timetable}
        renderData={(t) => (
          <ol className="space-y-0">
            {t.entries.map((e, i) => (
              <li key={e.sequence} className="relative flex gap-3 pb-3">
                {i < t.entries.length - 1 && (
                  <span aria-hidden className="absolute top-4 left-[5px] h-full w-0.5 bg-navy-100" />
                )}
                <span
                  aria-hidden
                  className={`relative mt-1 h-3 w-3 shrink-0 rounded-full ${
                    i === 0 ? "border-2 border-navy-400 bg-white" : i === t.entries.length - 1 ? "bg-saffron-500" : "bg-navy-200"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-navy-900 [overflow-wrap:anywhere]">
                    {e.station.name} <span className="font-normal text-navy-400">({e.station.code})</span>
                  </p>
                  <p className="text-[11px] text-navy-600 tabular-nums">
                    arr {e.arrival ?? "—"} · dep {e.departure ?? "—"}
                    {e.haltMinutes != null ? ` · halt ${e.haltMinutes}m` : ""}
                    {e.platform ? ` · pf ${e.platform}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      />

      <EnvelopePanel
        title="Live status"
        envelope={live}
        renderData={(s) => (
          <ul className="space-y-1 text-[12px] text-navy-800">
            <li className="flex justify-between gap-3">
              <span className="text-navy-500">Running</span>
              <span className="font-semibold">{s.running === null ? "Not reported" : s.running ? "Yes" : "No"}</span>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-navy-500">Last reported at</span>
              <span className="font-semibold">
                {s.lastStation ? `${s.lastStation.name} (${s.lastStation.code})` : "Not reported"}
              </span>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-navy-500">Delay</span>
              <span className="font-semibold">
                {s.delayMinutes === null ? "Not reported" : s.delayMinutes === 0 ? "On time" : `Late by ${s.delayMinutes} min`}
              </span>
            </li>
            {s.updatedAt && (
              <li className="flex justify-between gap-3">
                <span className="text-navy-500">Updated</span>
                <span className="font-semibold">{s.updatedAt}</span>
              </li>
            )}
          </ul>
        )}
      />
    </div>
  );
}
