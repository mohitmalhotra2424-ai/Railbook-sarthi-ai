"use client";

import { useState } from "react";
import { EnvelopePanel } from "./EnvelopePanel";
import { NotConfiguredBanner } from "./NotConfiguredBanner";
import type { Availability, Fare, LiveStatus, Timetable, TrainDetails } from "@/domain/schemas";
import type { ResultEnvelope } from "@/providers/types";
import { availabilityKind, inr, KIND_LABEL, KIND_PILL } from "./results/status";

type Env<T> = ResultEnvelope<T | null>;

const TABS = ["Overview", "Route", "Classes & Fare", "Availability"] as const;
type Tab = (typeof TABS)[number];

/** Client-side tabs over server-fetched envelopes. No data is invented here;
 *  every section renders exactly what the provider envelopes contain. */
export function TrainDetailsTabs({
  today,
  details,
  timetable,
  live,
  availability,
  fareRows,
  faresNotConfigured,
}: {
  today: string;
  details: Env<TrainDetails>;
  timetable: Env<Timetable>;
  live: Env<LiveStatus>;
  availability: Env<Availability> | null;
  fareRows: { classCode: string; env: Env<Fare> }[];
  faresNotConfigured: boolean;
}) {
  const [tab, setTab] = useState<Tab>("Overview");

  return (
    <div>
      <div role="tablist" aria-label="Train information sections" className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            id={`tab-${t.replace(/[^a-z]/gi, "").toLowerCase()}`}
            aria-controls={`panel-${t.replace(/[^a-z]/gi, "").toLowerCase()}`}
            aria-selected={tab === t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-3.5 py-1.5 text-[11px] font-bold transition ${
              tab === t
                ? "bg-navy-800 text-white"
                : "border border-cream-300 bg-white text-navy-700 hover:border-navy-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-3" role="tabpanel" id={`panel-${tab.replace(/[^a-z]/gi, "").toLowerCase()}`} aria-labelledby={`tab-${tab.replace(/[^a-z]/gi, "").toLowerCase()}`}>
        {tab === "Overview" && (
          <div className="space-y-3">
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
                    <span aria-hidden className="mx-1 w-10 border-t-2 border-dotted border-navy-200 sm:w-16" />
                    <div className="min-w-0 text-right">
                      <p className="text-lg font-bold text-navy-900 tabular-nums">{d.arrival || "—"}</p>
                      <p className="text-[11px] text-navy-600 [overflow-wrap:anywhere]">
                        {d.to.name} ({d.to.code})
                      </p>
                    </div>
                  </div>
                </div>
              )}
            />
            <EnvelopePanel
              title="Running status (live)"
              envelope={live}
              renderData={(s) => (
                <ul className="space-y-1 text-[12px] text-navy-800">
                  <li className="flex justify-between gap-3">
                    <span className="text-navy-500">Running</span>
                    <span className="font-semibold">{s.running === null ? "Not reported" : s.running ? "Yes" : "No"}</span>
                  </li>
                  <li className="flex justify-between gap-3">
                    <span className="text-navy-500">Last reported at</span>
                    <span className="text-right font-semibold">
                      {s.lastStation ? `${s.lastStation.name} (${s.lastStation.code})` : "Not reported"}
                    </span>
                  </li>
                  <li className="flex justify-between gap-3">
                    <span className="text-navy-500">Delay</span>
                    <span className="font-semibold">
                      {s.delayMinutes === null
                        ? "Not reported"
                        : s.delayMinutes === 0
                          ? "On time"
                          : `Late by ${s.delayMinutes} min`}
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
        )}

        {tab === "Route" && (
          <EnvelopePanel
            title="Route & scheduled timings"
            envelope={timetable}
            renderData={(t) => (
              <ol>
                {t.entries.map((e, i) => (
                  <li key={e.sequence} className="relative flex gap-3 pb-3">
                    {i < t.entries.length - 1 && (
                      <span aria-hidden className="absolute top-4 left-[5px] h-full w-0.5 bg-navy-100" />
                    )}
                    <span
                      aria-hidden
                      className={`relative mt-1 h-3 w-3 shrink-0 rounded-full ${
                        i === 0
                          ? "border-2 border-navy-400 bg-white"
                          : i === t.entries.length - 1
                            ? "bg-saffron-500"
                            : "bg-navy-200"
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
        )}

        {tab === "Classes & Fare" && (
          <div className="space-y-3">
            {details.data?.classes && details.data.classes.length > 0 && (
              <div className="rounded-2xl border border-cream-300 bg-white p-4">
                <p className="text-[10px] font-bold tracking-wide text-navy-500 uppercase">Travel classes</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {details.data.classes.map((c) => (
                    <span key={c} className="rounded-md bg-navy-50 px-2 py-0.5 text-[11px] font-semibold text-navy-700">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <section className="overflow-hidden rounded-2xl border border-cream-300 bg-white">
              <p className="border-b border-cream-200 px-4 py-2 text-[10px] font-bold tracking-wide text-navy-500 uppercase">
                Fares by class · {today}
              </p>
              {faresNotConfigured ? (
                <div className="p-4">
                  <NotConfiguredBanner />
                </div>
              ) : fareRows.length === 0 ? (
                <p className="px-4 py-3 text-xs text-navy-600">No fare data returned for this route.</p>
              ) : (
                <>
                  <div className="grid grid-cols-[3.5rem_1fr] gap-2 px-4 py-1.5 text-[10px] font-bold tracking-wide text-navy-400 uppercase">
                    <span>Class</span>
                    <span className="text-right">Fare (₹)</span>
                  </div>
                  <ul className="px-4 pb-3">
                    {fareRows.map((r) => (
                      <li
                        key={r.classCode}
                        className="grid grid-cols-[3.5rem_1fr] items-center gap-2 border-t border-cream-200 py-1.5 text-[12px]"
                      >
                        <span className="font-bold text-navy-900">{r.classCode}</span>
                        <span className="text-right font-bold text-navy-900 tabular-nums">
                          {inr(r.env.data!.totalFare)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        )}

        {tab === "Availability" &&
          (availability ? (
            <EnvelopePanel
              title={`Seat availability · ${today}`}
              envelope={availability}
              renderData={(a) => (
                <div>
                  <div className="grid grid-cols-[3.5rem_1fr_auto] gap-2 px-0.5 py-1.5 text-[10px] font-bold tracking-wide text-navy-400 uppercase">
                    <span>Class</span>
                    <span>Availability</span>
                    <span>Status</span>
                  </div>
                  <ul>
                    {a.classes.map((c) => {
                      const kind = availabilityKind(c.status);
                      return (
                        <li
                          key={c.classCode}
                          className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2 border-t border-cream-200 py-1.5 text-[12px]"
                        >
                          <span className="font-bold text-navy-900">{c.classCode}</span>
                          <span className="min-w-0 truncate font-medium text-navy-700">{c.status}</span>
                          <span className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${KIND_PILL[kind]}`}>
                            <span
                              aria-hidden
                              className={`h-2 w-2 rounded-full ${
                                kind === "available"
                                  ? "bg-signal-500"
                                  : kind === "rac"
                                    ? "bg-saffron-500"
                                    : kind === "unknown"
                                      ? "bg-navy-300"
                                      : "bg-alert-500"
                              }`}
                            />
                            {KIND_LABEL[kind]}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            />
          ) : (
            <div className="rounded-2xl border border-cream-300 bg-white p-4">
              <NotConfiguredBanner />
            </div>
          ))}
      </div>
    </div>
  );
}
