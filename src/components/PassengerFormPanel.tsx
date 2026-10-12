"use client";

import { useState } from "react";
import {
  MAX_PASSENGERS,
  REQUIRED_PASSENGER_FIELDS,
  type PassengerDraft,
  type ReviewState,
  type SelectionState,
} from "@/assistant/context/store";
import type { ReadinessResult } from "@/assistant/booking/preparation";
import Link from "next/link";
import { CheckIcon, WarnIcon } from "./icons";

export interface PassengerFormState {
  selection: SelectionState | null;
  passengers: PassengerDraft[];
  /** Prompt 31 — backend-authoritative readiness + review state. */
  readiness?: ReadinessResult | null;
  review?: ReviewState | null;
}

/**
 * Prompt 25 — passenger form (data collection & review ONLY; no booking).
 * Values arrive only through the validated backend path (chat/voice action or
 * /api/passenger manual edits). Manual inputs remain as a fallback and go
 * through the SAME validators. Nothing is invented; unsupported capabilities
 * (food preference, verified berth options) are labelled honestly.
 */
export function PassengerFormPanel({
  state,
  conversationId,
  onState,
}: {
  state: PassengerFormState;
  conversationId: string | null;
  onState: (s: PassengerFormState) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sel = state.selection;
  if (!sel?.classCode) return null; // form appears only after train + class are selected (tap, voice or chat)

  const act = async (action: "review" | "confirm") => {
    if (!conversationId) return;
    const res = await fetch("/api/passenger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, action }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      selection?: SelectionState | null;
      passengers?: PassengerDraft[];
      readiness?: ReadinessResult | null;
      review?: ReviewState | null;
    };
    onState({
      selection: data.selection ?? sel,
      passengers: data.passengers ?? state.passengers,
      readiness: data.readiness ?? null,
      review: data.review ?? null,
    });
  };

  const passengers = state.passengers.length ? state.passengers : [{}];
  const currentComplete = (p: PassengerDraft) =>
    REQUIRED_PASSENGER_FIELDS.every((f) => p[f] !== undefined);

  const edit = async (idx: number, field: string, value: string) => {
    if (!conversationId) return;
    const res = await fetch("/api/passenger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, passengerIndex: idx, field, value }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      selection?: SelectionState | null;
      passengers?: PassengerDraft[];
      readiness?: ReadinessResult | null;
      review?: ReviewState | null;
    };
    setErrors((e) => {
      const next = { ...e };
      const key = `${idx}:${field}`;
      if (data.ok) delete next[key];
      else next[key] = data.error ?? "Could not save.";
      return next;
    });
    if (data.ok && data.passengers) onState({ selection: data.selection ?? sel, passengers: data.passengers, readiness: data.readiness ?? null, review: data.review ?? null });
  };

  return (
    <div
      className="surface-shadow-soft animate-rise mt-4 overflow-hidden rounded-3xl border border-cream-300 bg-white"
      data-testid="passenger-form"
    >
      <div className="px-5 py-4">
        <p className="text-[14px] font-bold text-navy-950">Passenger details</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-navy-500">
          {sel.trainNumber} {sel.trainName ?? ""} · {sel.classCode}
          {sel.journeyDate ? ` · ${sel.journeyDate}` : ""}
          {sel.from && sel.to ? ` · ${sel.from} → ${sel.to}` : ""} — data collection & review only; booking disabled.
        </p>
      </div>

      {/* Prompt 30 — verified final review: authoritative state only, nothing fabricated. */}
      <div className="border-y border-cream-200 bg-cream-100/70 px-5 py-4" data-testid="journey-review">
        <p className="text-[10px] font-bold tracking-[0.14em] text-navy-500 uppercase">Journey review</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
          <div>
            <dt className="text-navy-500">Train</dt>
            <dd className="font-semibold text-navy-950">
              {sel.trainNumber}
              {sel.trainName ? ` — ${sel.trainName}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-navy-500">Date</dt>
            <dd className="font-semibold text-navy-950">{sel.journeyDate ?? "Not confirmed"}</dd>
          </div>
          <div>
            <dt className="text-navy-500">Route</dt>
            <dd className="font-semibold text-navy-950">{sel.from && sel.to ? `${sel.from} → ${sel.to}` : "Not confirmed"}</dd>
          </div>
          <div>
            <dt className="text-navy-500">Class</dt>
            <dd className="font-semibold text-navy-950">{sel.classCode}</dd>
          </div>
        </dl>
        <ul className="mt-2.5 space-y-1">
          {passengers.map((p, i) => {
            const missing = REQUIRED_PASSENGER_FIELDS.filter((f) => p[f] === undefined);
            return (
              <li key={i} className="flex items-center gap-1.5 text-[11px]" data-testid={`review-pax-${i + 1}`}>
                {missing.length === 0 ? (
                  <>
                    <CheckIcon className="h-3 w-3 text-signal-500" />
                    <span className="font-semibold text-signal-700">Passenger {i + 1} complete</span>
                  </>
                ) : (
                  <>
                    <WarnIcon className="h-3 w-3 text-saffron-500" />
                    <span className="text-navy-700">
                      Passenger {i + 1} — missing: <b>{missing.join(", ")}</b>
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {state.readiness && !state.readiness.ready && (
          <p className="mt-2 text-[10px] font-semibold text-saffron-600" data-testid="review-blocked">
            Review blocked — {state.readiness.missingFields.length
              ? `missing: ${state.readiness.missingFields.join(", ")}`
              : state.readiness.blockers.map((b) => b.code).join(", ")}
          </p>
        )}
        {state.readiness?.ready && (
          <p className="mt-2 text-[10px] font-semibold text-navy-600" data-testid="review-ready">
            All required details saved. Review only — booking execution is disabled.
          </p>
        )}
        {state.readiness?.ready && !state.review && (
          <button
            type="button"
            data-testid="build-review"
            onClick={() => void act("review")}
            className="mt-2.5 rounded-xl bg-navy-900 px-4 py-2 text-[11.5px] font-bold text-white transition hover:bg-navy-800"
          >
            Review details
          </button>
        )}
        {state.review?.status === "awaiting_confirmation" && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2" data-testid="review-awaiting">
            <p className="text-[10px] font-semibold text-navy-700">
              Review v{state.review.version} built — confirm the details above to mark handoff-ready.
            </p>
            <button
              type="button"
              data-testid="confirm-review"
              onClick={() => void act("confirm")}
              className="rounded-xl bg-navy-900 px-4 py-2 text-[11.5px] font-bold text-white transition hover:bg-navy-800"
            >
              Confirm details
            </button>
          </div>
        )}
        {state.review?.status === "confirmed" && (
          <p className="mt-2.5 text-[10px] font-bold text-signal-700" data-testid="handoff-ready">
            IRCTC_HANDOFF_READY — booking details ready for handoff. Actual booking execution is not enabled.
          </p>
        )}
      </div>

      {/* Passenger cards — calm, compact, one card per traveller */}
      <div className="space-y-3 px-4 py-4 sm:px-5">
        {passengers.map((p, i) => {
          const nextMissing = REQUIRED_PASSENGER_FIELDS.find((f) => p[f] === undefined);
          return (
            <fieldset key={i} className="rounded-2xl border border-cream-300 bg-cream-50 p-4">
              <legend className="sr-only">Passenger {i + 1}</legend>
              <p className="flex items-center gap-2 text-[12.5px] font-bold text-navy-950">
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[11px] font-bold text-white"
                >
                  {p.name ? p.name.trim().charAt(0).toUpperCase() : i + 1}
                </span>
                {p.name ? p.name : `Passenger ${i + 1}`}
                {currentComplete(p) && (
                  <span className="flex items-center gap-1 rounded-full bg-signal-500/10 px-2 py-0.5 text-[9.5px] font-bold text-signal-700">
                    <CheckIcon className="h-2.5 w-2.5" /> complete
                  </span>
                )}
              </p>
              <div className="mt-3 grid gap-3">
                {(
                  [
                    { field: "name", label: "Name", value: p.name ?? "", ph: "Passenger ka naam" },
                    { field: "age", label: "Age", value: p.age !== undefined ? String(p.age) : "", ph: "e.g. 28" },
                    { field: "gender", label: "Gender", value: p.gender ?? "", ph: "male / female / other" },
                  ] as const
                ).map((f) => {
                  const done = f.value !== "";
                  const isNext = nextMissing === f.field;
                  const err = errors[`${i + 1}:${f.field}`];
                  return (
                    <label key={f.field} className="block">
                      <span className="flex items-center gap-1.5 text-[10.5px] font-semibold text-navy-600">
                        {f.label}
                        {done ? (
                          <CheckIcon className="h-3 w-3 text-signal-500" />
                        ) : isNext ? (
                          <span className="rounded-full bg-saffron-500/10 px-1.5 py-0.5 text-[9px] font-bold text-saffron-600" data-testid="form-next-field">
                            assistant is asking this now
                          </span>
                        ) : null}
                      </span>
                      <input
                        aria-label={`Passenger ${i + 1} ${f.label}`}
                        defaultValue={f.value}
                        placeholder={f.ph}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== f.value) void edit(i + 1, f.field, v);
                        }}
                        className={`mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-[13px] text-navy-950 focus:outline-none focus:ring-2 focus:ring-navy-300 ${
                          err ? "border-alert-500" : "border-cream-300"
                        }`}
                      />
                      {err && (
                        <span className="mt-1 flex items-center gap-1 text-[9.5px] font-semibold text-alert-500" data-testid="form-field-error">
                          <WarnIcon className="h-2.5 w-2.5" /> {err}
                        </span>
                      )}
                    </label>
                  );
                })}
                <label className="block">
                  <span className="flex items-center gap-1.5 text-[10.5px] font-semibold text-navy-600">
                    Berth preference
                    {p.berth ? (
                      <CheckIcon className="h-3 w-3 text-signal-500" />
                    ) : nextMissing === "berth" ? (
                      <span className="rounded-full bg-saffron-500/10 px-1.5 py-0.5 text-[9px] font-bold text-saffron-600" data-testid="form-next-field">
                        assistant is asking this now
                      </span>
                    ) : null}
                  </span>
                  <input
                    aria-label={`Passenger ${i + 1} berth preference`}
                    defaultValue={p.berth ?? ""}
                    placeholder="e.g. lower berth — required, request only"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== (p.berth ?? "")) void edit(i + 1, "berth", v);
                    }}
                    className={`mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-[13px] text-navy-950 focus:outline-none focus:ring-2 focus:ring-navy-300 ${
                      errors[`${i + 1}:berth`] ? "border-alert-500" : "border-cream-300"
                    }`}
                  />
                  {errors[`${i + 1}:berth`] && (
                    <span className="mt-1 flex items-center gap-1 text-[9.5px] font-semibold text-alert-500" data-testid="form-field-error">
                      <WarnIcon className="h-2.5 w-2.5" /> {errors[`${i + 1}:berth`]}
                    </span>
                  )}
                  <span className="mt-1 block text-[9.5px] leading-snug text-navy-500">
                    Mandatory for review. A request only — no authorised provider verifies berth options; not a guarantee.
                  </span>
                </label>
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="border-t border-cream-200 px-5 py-4">
        <p className="text-[9.5px] leading-snug text-navy-500">
          Food preference: not supported by any authorised integration — field omitted. Nothing invented.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {conversationId && (
            <Link
              href={`/review?c=${encodeURIComponent(conversationId)}`}
              data-testid="open-review-page"
              className="rounded-xl border border-cream-300 bg-white px-3.5 py-2 text-[11.5px] font-bold text-navy-800 transition hover:border-navy-400"
            >
              Full review page par dekhein →
            </Link>
          )}
          {currentComplete(passengers[passengers.length - 1] ?? {}) && passengers.length < MAX_PASSENGERS && (
            <button
              type="button"
              data-testid="add-passenger"
              onClick={() => {
                if (!conversationId) return;
                void fetch("/api/passenger", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ conversationId, action: "add" }),
                })
                  .then((r) => r.json())
                  .then((d: { ok: boolean; selection?: SelectionState | null; passengers?: PassengerDraft[] }) => {
                    if (d.ok && d.passengers) onState({ selection: d.selection ?? sel, passengers: d.passengers });
                  });
              }}
              className="rounded-xl border border-cream-300 bg-white px-3.5 py-2 text-[11.5px] font-bold text-navy-800 transition hover:border-navy-400"
            >
              + Add passenger
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
