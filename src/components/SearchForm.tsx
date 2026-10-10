"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { TrainSummary } from "@/domain/schemas";
import type { ResultEnvelope } from "@/providers/types";
import { isNotConfigured } from "@/providers/envelope";
import { FreshnessPill } from "./FreshnessPill";
import { NotConfiguredBanner } from "./NotConfiguredBanner";
import { SourceBadge } from "./SourceBadge";

const EMPTY: ResultEnvelope<TrainSummary[] | null> = {
  data: null,
  source: { providerId: "none", kind: "none", termsRef: "", authorization: "not-configured" },
  retrievedAt: new Date(0).toISOString(),
  freshness: "unknown",
  ttlSeconds: 0,
  errors: [],
  confidence: "low",
  requestId: "",
};

export function SearchForm() {
  const [params, setParams] = useState({ text: "", from: "", to: "", date: "" });
  const [submitted, setSubmitted] = useState<typeof params | null>(null);

  const query = useQuery({
    queryKey: ["train-search", submitted],
    enabled: submitted !== null,
    queryFn: async () => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(submitted ?? {})) if (v) qs.set(k, v);
      const res = await fetch(`/api/railway/search?${qs.toString()}`);
      return (await res.json()) as ResultEnvelope<TrainSummary[] | null>;
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(params);
  }

  const envelope = query.data ?? EMPTY;
  const showResult = submitted !== null;

  return (
    <div className="space-y-4">
      <form
        onSubmit={onSubmit}
        className="grid gap-3 rounded-3xl border border-cream-300 bg-cream-50 p-4 shadow-sm sm:grid-cols-2 sm:p-5"
        data-testid="search-form"
      >
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold tracking-wide text-navy-600 uppercase">
            Search text / खोज
          </span>
          <input
            value={params.text}
            onChange={(e) => setParams((p) => ({ ...p, text: e.target.value }))}
            placeholder="e.g. rajdhani, shatabdi, 12951"
            className="w-full rounded-xl border border-cream-300 bg-white px-3.5 py-2.5 text-sm text-navy-900 placeholder:text-navy-300 focus:border-navy-400 focus:outline-none"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-semibold tracking-wide text-navy-600 uppercase">
            From (station code)
          </span>
          <input
            value={params.from}
            onChange={(e) => setParams((p) => ({ ...p, from: e.target.value }))}
            placeholder="NDLS"
            className="w-full rounded-xl border border-cream-300 bg-white px-3.5 py-2.5 text-sm text-navy-900 placeholder:text-navy-300 focus:border-navy-400 focus:outline-none"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-semibold tracking-wide text-navy-600 uppercase">
            To (station code)
          </span>
          <input
            value={params.to}
            onChange={(e) => setParams((p) => ({ ...p, to: e.target.value }))}
            placeholder="BCT"
            className="w-full rounded-xl border border-cream-300 bg-white px-3.5 py-2.5 text-sm text-navy-900 placeholder:text-navy-300 focus:border-navy-400 focus:outline-none"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold tracking-wide text-navy-600 uppercase">
            Date
          </span>
          <input
            type="date"
            value={params.date}
            onChange={(e) => setParams((p) => ({ ...p, date: e.target.value }))}
            className="w-full rounded-xl border border-cream-300 bg-white px-3.5 py-2.5 text-sm text-navy-900 focus:border-navy-400 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-cream-50 transition hover:bg-navy-800 sm:col-span-2"
        >
          Search trains
        </button>
      </form>

      {query.isError && (
        <p className="text-sm text-alert-500">Search request failed. Please try again.</p>
      )}

      {showResult && query.isLoading && (
        <p className="text-sm text-navy-600" data-testid="search-loading">
          Contacting authorized providers…
        </p>
      )}

      {showResult && query.data && (
        <section className="rounded-3xl border border-cream-300 bg-cream-50 p-4 shadow-sm sm:p-5">
          <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-wide text-navy-900 uppercase">Results</h2>
            <div className="flex flex-wrap items-center gap-2">
              <SourceBadge source={envelope.source} />
              <FreshnessPill freshness={envelope.freshness} retrievedAt={envelope.retrievedAt} />
            </div>
          </header>

          {isNotConfigured(envelope) ? (
            <NotConfiguredBanner />
          ) : envelope.data && envelope.data.length > 0 ? (
            <ul className="space-y-2" data-testid="search-results">
              {envelope.data.map((t) => (
                <li
                  key={t.trainNumber}
                  className="rounded-2xl border border-cream-300 bg-white p-3 text-sm"
                >
                  <p className="font-semibold text-navy-900">
                    {t.trainNumber} — {t.trainName}
                  </p>
                  <p className="mt-0.5 text-xs text-navy-600">
                    {t.from.name} ({t.from.code}) → {t.to.name} ({t.to.code}) · dep {t.departure} ·
                    arr {t.arrival}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-navy-600">
              No verified results returned. Nothing is guessed or filled in.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
