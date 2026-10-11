"use client";

import { useState } from "react";
import {
  MAX_PASSENGERS,
  REQUIRED_PASSENGER_FIELDS,
  type PassengerDraft,
  type SelectionState,
} from "@/assistant/context/store";
import { CheckIcon, WarnIcon } from "./icons";

export interface PassengerFormState {
  selection: SelectionState | null;
  passengers: PassengerDraft[];
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
  if (!sel?.classCode) return null; // form opens only after valid train+class

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
    };
    setErrors((e) => {
      const next = { ...e };
      const key = `${idx}:${field}`;
      if (data.ok) delete next[key];
      else next[key] = data.error ?? "Could not save.";
      return next;
    });
    if (data.ok && data.passengers) onState({ selection: data.selection ?? sel, passengers: data.passengers });
  };

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-sm" data-testid="passenger-form">
      <div className="border-b border-cream-200 bg-navy-900 px-3.5 py-2.5">
        <p className="text-[12px] font-bold text-white">Passenger details</p>
        <p className="mt-0.5 text-[10px] text-navy-200">
          {sel.trainNumber} {sel.trainName ?? ""} · {sel.classCode}
          {sel.journeyDate ? ` · ${sel.journeyDate}` : ""} — data collection & review only; booking disabled.
        </p>
      </div>

      {passengers.map((p, i) => {
        const nextMissing = REQUIRED_PASSENGER_FIELDS.find((f) => p[f] === undefined);
        return (
          <fieldset key={i} className="border-b border-cream-200 px-3.5 py-3">
            <legend className="sr-only">Passenger {i + 1}</legend>
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-navy-900">
              Passenger {i + 1}
              {currentComplete(p) && (
                <span className="flex items-center gap-1 rounded-full bg-signal-500/10 px-2 py-0.5 text-[9px] font-bold text-signal-700">
                  <CheckIcon className="h-2.5 w-2.5" /> complete
                </span>
              )}
            </p>
            <div className="mt-2 grid gap-2">
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
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold text-navy-700">
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
                      className={`mt-1 w-full rounded-lg border px-2.5 py-1.5 text-[12px] text-navy-900 focus:outline-none focus:ring-2 focus:ring-navy-300 ${
                        err ? "border-alert-500" : "border-cream-300"
                      }`}
                    />
                    {err && (
                      <span className="mt-0.5 flex items-center gap-1 text-[9px] font-semibold text-alert-500" data-testid="form-field-error">
                        <WarnIcon className="h-2.5 w-2.5" /> {err}
                      </span>
                    )}
                  </label>
                );
              })}
              <label className="block">
                <span className="text-[10px] font-semibold text-navy-700">Berth preference (optional)</span>
                <input
                  aria-label={`Passenger ${i + 1} berth preference`}
                  defaultValue={p.berth ?? ""}
                  placeholder="e.g. lower berth — request only"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== (p.berth ?? "")) void edit(i + 1, "berth", v);
                  }}
                  className="mt-1 w-full rounded-lg border border-cream-300 px-2.5 py-1.5 text-[12px] text-navy-900 focus:outline-none focus:ring-2 focus:ring-navy-300"
                />
                <span className="mt-0.5 block text-[9px] text-navy-500">
                  A request only — no authorised provider verifies berth options; not a guarantee.
                </span>
              </label>
            </div>
          </fieldset>
        );
      })}

      <div className="px-3.5 py-2.5">
        <p className="text-[9px] text-navy-500">
          Food preference: not supported by any authorised integration — field omitted. Nothing invented.
        </p>
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
            className="mt-2 rounded-full border border-navy-200 bg-white px-3 py-1.5 text-[10px] font-bold text-navy-800 transition hover:border-navy-400"
          >
            + Add passenger
          </button>
        )}
      </div>
    </div>
  );
}
