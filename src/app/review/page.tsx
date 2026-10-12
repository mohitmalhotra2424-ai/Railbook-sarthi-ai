"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  REQUIRED_PASSENGER_FIELDS,
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
    <div className="min-h-screen bg-cream-50 text-navy-900">
      <header className="bg-navy-800">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Link href="/chat" aria-label="Chat par jaayein" className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
            <BrandMark className="h-5 w-5" />
          </Link>
          <h1 className="text-[15px] font-extrabold text-white">Journey review</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-4" data-testid="review-page">
        {!snap && !error && <p className="text-[12px] text-navy-600">Loading…</p>}
        {error && (
          <p className="rounded-xl border border-alert-500 bg-white px-3 py-2 text-[12px] font-semibold text-alert-500" data-testid="review-error">
            {error}
          </p>
        )}
        {snap && !sel && (
          <p className="rounded-xl border border-cream-300 bg-white px-3 py-2 text-[12px] text-navy-700">
            Abhi koi train select nahi hui. <Link className="font-bold text-navy-900 underline" href="/chat">Chat mein train chuniye</Link>.
          </p>
        )}

        {snap && sel && (
          <>
            <section className="overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-sm">
              <div className="bg-navy-900 px-4 py-3">
                <p className="text-[14px] font-extrabold text-white">
                  {sel.trainNumber} {sel.trainName ?? ""}
                </p>
                <p className="mt-0.5 text-[11px] text-navy-200">
                  {sel.from ?? "—"} → {sel.to ?? "—"} · {sel.journeyDate ?? "date not set"} · Class {sel.classCode ?? "—"}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-[12px]">
                <div>
                  <dt className="text-navy-500">From / To</dt>
                  <dd className="font-bold">{sel.from ?? "—"} → {sel.to ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-navy-500">Journey date</dt>
                  <dd className="font-bold">{sel.journeyDate ?? "Not set"}</dd>
                </div>
                <div>
                  <dt className="text-navy-500">Selected class</dt>
                  <dd className="font-bold">{sel.classCode ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-navy-500">Fare</dt>
                  <dd className="font-bold" data-testid="review-fare">
                    {snap.fare && snap.fare.freshness !== "stale" ? (
                      <>₹{snap.fare.totalFare} ({snap.fare.classCode})</>
                    ) : snap.fare ? (
                      "Fare stale — chat mein dobara Check Fare karein"
                    ) : (
                      "Fare verify nahi hui — chat mein Check Fare use karein"
                    )}
                  </dd>
                  {snap.fare && snap.fare.freshness !== "stale" && snap.fare.retrievedAt && (
                    <p className="text-[10px] text-navy-500">provider-verified {new Date(snap.fare.retrievedAt).toLocaleString()}</p>
                  )}
                </div>
                <div className="col-span-2">
                  <dt className="text-navy-500">Availability</dt>
                  <dd className="font-bold" data-testid="review-availability">
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

            <section className="mt-3 overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-sm">
              <p className="border-b border-cream-200 bg-cream-100 px-4 py-2 text-[11px] font-bold">Passengers</p>
              <ul className="divide-y divide-cream-200">
                {(snap.passengers.length ? snap.passengers : [{}]).map((p, i) => {
                  const missing = REQUIRED_PASSENGER_FIELDS.filter((f) => p[f] === undefined);
                  return (
                    <li key={i} className="px-4 py-2.5 text-[12px]" data-testid={`review-page-pax-${i + 1}`}>
                      {missing.length === 0 ? (
                        <span className="flex items-center gap-1.5 font-semibold">
                          <CheckIcon className="h-3.5 w-3.5 text-signal-500" />
                          P{i + 1}: {p.name} · {p.age} yrs · {p.gender} · berth: {p.berth}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-navy-700">
                          <WarnIcon className="h-3.5 w-3.5 text-saffron-500" />
                          P{i + 1} — missing: <b>{missing.join(", ")}</b>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {!ready && snap.readiness && (
              <p className="mt-3 rounded-xl border border-saffron-500 bg-saffron-500/10 px-3 py-2 text-[11px] font-semibold text-saffron-600" data-testid="review-missing">
                Review complete nahi ho sakti — {snap.readiness.missingFields.length ? `missing: ${snap.readiness.missingFields.join(", ")}` : snap.readiness.blockers.map((b) => b.code).join(", ")} ·{" "}
                <Link href="/chat" className="underline">chat mein bharein</Link>
              </p>
            )}

            {ready && !confirmed && (
              <button
                type="button"
                data-testid="proceed-irctc"
                disabled={busy}
                onClick={() => void proceed()}
                className="mt-4 w-full rounded-2xl bg-navy-900 px-4 py-3 text-[13px] font-extrabold text-white transition hover:bg-navy-800 disabled:opacity-50"
              >
                Proceed to IRCTC
              </button>
            )}

            {confirmed && (
              <p className="mt-4 rounded-2xl border-2 border-signal-500 bg-signal-500/10 px-4 py-3 text-[12px] font-bold text-signal-700" data-testid="handoff-ready">
                IRCTC_HANDOFF_READY — booking details ready for handoff. Actual booking execution is not enabled; no ticket has been issued.
              </p>
            )}

            <p className="mt-3 text-[10px] text-navy-500">
              Review sirf authoritative session state dikhata hai. Booking, payment, OTP/CAPTCHA disabled hain.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
