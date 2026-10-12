"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  requiredFieldsFor,
  type PassengerDraft,
  type ReviewState,
  type SelectionState,
} from "@/assistant/context/store";
import type { ReadinessResult } from "@/assistant/booking/preparation";
import { BrandMark, CheckIcon, WarnIcon } from "@/components/icons";

/**
 * Prompt 33 — dedicated review page ("next page" after the passenger form).
 * Renders ONLY authoritative session state fetched from /api/passenger (GET):
 * train name/number, from/to stations, journey date, selected class, verified
 * fare/availability (honestly labelled when absent or stale) and passenger
 * details. "Proceed to IRCTC" runs the existing validated review→confirm
 * boundary and ends at the preparation-only IRCTC_HANDOFF_READY state —
 * booking execution stays disabled and is said so explicitly.
 */

interface Snapshot {
  selection: SelectionState | null;
  passengers: PassengerDraft[];
  readiness: ReadinessResult | null;
  review: ReviewState | null;
  fare: { classCode: string; totalFare: number; currency: string; retrievedAt: string | null; freshness: string } | null;
  availability: { classes: { classCode: string; status: string }[]; retrievedAt: string | null; freshness: string } | null;
  times: { departure: string; arrival: string | null } | null;
}

export default function ReviewPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("c");
    let cid = param;
    try {
      cid = cid || localStorage.getItem("railsaarthi.cid");
    } catch {
      /* private mode */
    }
    setConversationId(cid);
  }, []);

  const load = useCallback(async () => {
    if (!conversationId) return;
    const res = await fetch(`/api/passenger?conversationId=${encodeURIComponent(conversationId)}`);
    if (!res.ok) {
      setError("Review state load nahi hua — chat se dobara try karein.");
      return;
    }
    const data = (await res.json()) as Snapshot;
    setSnap(data);
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const proceed = async () => {
    if (!conversationId || busy) return;
    setBusy(true);
    setError(null);
    const post = (action: string) =>
      fetch("/api/passenger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, action }),
      }).then((r) => r.json() as Promise<{ ok: boolean; error?: string } & Partial<Snapshot>>);
    const rv = await post("review");
    if (!rv.ok) {
      setError(rv.error ?? "Review build nahi hua.");
      await load();
      setBusy(false);
      return;
    }
    const cf = await post("confirm");
    if (!cf.ok) {
      setError(cf.error ?? "Confirm nahi hua.");
    }
    await load();
    setBusy(false);
  };

  const sel = snap?.selection ?? null;
  const ready = snap?.readiness?.ready ?? false;
  const confirmed = snap?.review?.status === "confirmed";
  const availForClass = snap?.availability?.classes.find((c) => c.classCode === sel?.classCode);

  return (
    <div className="min-h-dvh bg-cream-100 text-navy-950">
      <header className="border-b border-cream-300 bg-cream-50/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Link
            href={conversationId ? `/passengers?c=${encodeURIComponent(conversationId)}` : "/chat"}
            aria-label="Passenger details par jaayein"
            className="flex h-9 w-9 items-center justify-center rounded-2xl bg-navy-900 text-white transition hover:bg-navy-800"
          >
            <BrandMark className="h-4.5 w-4.5" />
          </Link>
          <h1 className="text-[15px] font-bold text-navy-950">Journey review</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5" data-testid="review-page">
        {!snap && !error && <p className="text-[12.5px] text-navy-600">Review state load ho raha hai…</p>}
        {error && (
          <p className="rounded-2xl border border-alert-500/40 bg-white px-4 py-3 text-[12.5px] font-semibold text-alert-500" data-testid="review-error">
            {error}
          </p>
        )}
        {snap && !sel && (
          <p className="rounded-2xl border border-cream-300 bg-white px-4 py-3 text-[12.5px] text-navy-700">
            Abhi koi train select nahi hui. <Link className="font-bold text-navy-900 underline" href="/chat">Chat mein train chuniye</Link>.
          </p>
        )}

        {snap && sel && (
          <>
            <p
              data-testid="review-status"
              aria-live="polite"
              className={`rounded-full px-3.5 py-1.5 text-[11px] font-bold w-fit ${
                confirmed
                  ? "bg-signal-500/15 text-signal-700"
                  : ready
                    ? "bg-navy-900/10 text-navy-800"
                    : "bg-saffron-500/15 text-saffron-600"
              }`}
            >
              {confirmed
                ? "Preparation complete — booking provider unavailable"
                : snap.review?.status === "awaiting_confirmation"
                  ? "Awaiting explicit approval"
                  : ready
                    ? "Ready for review"
                    : "Review incomplete"}
            </p>
            {/* Journey + train card */}
            <section className="surface-shadow-soft animate-rise overflow-hidden rounded-3xl border border-cream-300 bg-white">
              <div className="px-5 py-4">
                <p className="text-[10px] font-bold tracking-[0.14em] text-navy-500 uppercase">Journey</p>
                <p className="mt-1.5 text-[18px] leading-snug font-extrabold text-navy-950">
                  {sel.from ?? "—"} <span aria-hidden className="text-navy-400">→</span> {sel.to ?? "—"}
                </p>
                <p className="mt-0.5 text-[12px] text-navy-600">{sel.journeyDate ?? "date not set"}</p>
                <p className="mt-0.5 text-[12px] text-navy-600" data-testid="review-pax-count">
                  {snap.passengers.length} passenger{snap.passengers.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="border-t border-cream-200 px-5 py-4">
                <p className="text-[10px] font-bold tracking-[0.14em] text-navy-500 uppercase">Train</p>
                <p className="mt-1.5 text-[15px] font-bold text-navy-950">
                  {sel.trainNumber} {sel.trainName ?? ""}
                </p>
                <p className="mt-1 inline-block rounded-full bg-cream-100 px-2.5 py-1 text-[11px] font-bold text-navy-700">
                  Class {sel.classCode ?? "—"}
                </p>
                {snap.times && (
                  <p className="mt-1.5 text-[12px] text-navy-600" data-testid="review-times">
                    Dep {snap.times.departure}
                    {snap.times.arrival ? ` · Arr ${snap.times.arrival}` : ""}
                  </p>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-cream-200 px-5 py-4 text-[12.5px]">
                <div className="col-span-2">
                  <dt className="text-[10px] font-bold tracking-[0.14em] text-navy-500 uppercase">Fare</dt>
                  <dd className="mt-1 font-bold text-navy-950" data-testid="review-fare">
                    {snap.fare && snap.fare.freshness !== "stale" ? (
                      <>₹{snap.fare.totalFare} ({snap.fare.classCode})</>
                    ) : snap.fare ? (
                      "Fare stale — chat mein dobara Check Fare karein"
                    ) : (
                      "Fare verify nahi hui — chat mein Check Fare use karein"
                    )}
                  </dd>
                  {snap.fare && snap.fare.freshness !== "stale" && snap.fare.retrievedAt && (
                    <p className="mt-0.5 text-[10px] text-navy-500">provider-verified {new Date(snap.fare.retrievedAt).toLocaleString()}</p>
                  )}
                </div>
                <div className="col-span-2">
                  <dt className="text-[10px] font-bold tracking-[0.14em] text-navy-500 uppercase">Availability</dt>
                  <dd className="mt-1 font-bold text-navy-950" data-testid="review-availability">
                    {snap.availability && snap.availability.freshness !== "stale" ? (
                      availForClass ? (
                        `${sel.classCode}: ${availForClass.status}`
                      ) : (
                        snap.availability.classes.map((c) => `${c.classCode} ${c.status}`).join(" · ")
                      )
                    ) : snap.availability ? (
                      "Availability stale — chat mein dobara check karein"
                    ) : (
                      "Availability verify nahi hui — chat mein Check Availability use karein"
                    )}
                  </dd>
                </div>
              </dl>
            </section>

            {/* Passengers card */}
            <section className="surface-shadow-soft animate-rise overflow-hidden rounded-3xl border border-cream-300 bg-white">
              <p className="border-b border-cream-200 bg-cream-100/70 px-5 py-2.5 text-[10px] font-bold tracking-[0.14em] text-navy-500 uppercase">
                Passengers
              </p>
              <ul className="divide-y divide-cream-200">
                {(snap.passengers.length ? snap.passengers : [{}]).map((p, i) => {
                  const missing = requiredFieldsFor(p).filter((f) => p[f] === undefined);
                  return (
                    <li key={i} className="flex items-center gap-3 px-5 py-3 text-[12.5px]" data-testid={`review-page-pax-${i + 1}`}>
                      <span
                        aria-hidden
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[12px] font-bold text-white"
                      >
                        {p.name ? p.name.trim().charAt(0).toUpperCase() : i + 1}
                      </span>
                      {missing.length === 0 ? (
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 font-bold text-navy-950">
                            <CheckIcon className="h-3.5 w-3.5 shrink-0 text-signal-500" />
                            {p.name}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-navy-600">
                            {p.age} yrs · {p.gender} · {p.category === "infant_without_berth" ? "Under 5, no separate berth — free travel rule" : `berth: ${p.berth}`}
                            {p.category === "infant_with_berth" && " · Under 5 with berth: full adult fare rule"}
                          </span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-navy-700">
                          <WarnIcon className="h-3.5 w-3.5 shrink-0 text-saffron-500" />
                          P{i + 1} — missing: <b>{missing.join(", ")}</b>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {!ready && snap.readiness && (
              <p className="rounded-2xl border border-saffron-500/40 bg-saffron-500/10 px-4 py-3 text-[11.5px] font-semibold text-saffron-600" data-testid="review-missing">
                Review complete nahi ho sakti — {snap.readiness.missingFields.length ? `missing: ${snap.readiness.missingFields.join(", ")}` : snap.readiness.blockers.map((b) => b.code).join(", ")} ·{" "}
                <Link href={conversationId ? `/passengers?c=${encodeURIComponent(conversationId)}` : "/chat"} className="underline">passenger details mein bharein</Link>
              </p>
            )}

            {!confirmed && (
              <button
                type="button"
                data-testid="proceed-irctc"
                disabled={!ready || busy}
                onClick={() => void proceed()}
                className="w-full rounded-2xl bg-navy-900 px-4 py-3.5 text-[14px] font-extrabold text-white transition hover:bg-navy-800 active:scale-[0.99] disabled:opacity-50"
              >
                Proceed to IRCTC
              </button>
            )}

            {confirmed && (
              <p className="rounded-2xl border-2 border-signal-500 bg-signal-500/10 px-4 py-3.5 text-[12.5px] leading-relaxed font-bold text-signal-700" data-testid="handoff-ready">
                IRCTC_HANDOFF_READY — booking details ready for handoff. Actual booking execution is not enabled; no ticket has been issued.
              </p>
            )}

            <p className="pb-2 text-[10.5px] leading-relaxed text-navy-500">
              Review sirf authoritative session state dikhata hai. Booking, payment, OTP/CAPTCHA disabled hain.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
