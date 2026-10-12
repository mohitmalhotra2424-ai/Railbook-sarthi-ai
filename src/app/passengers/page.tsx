"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatClient } from "@/components/ChatClient";
import type { PassengerFormState } from "@/components/PassengerFormPanel";
import type { PassengerCategory } from "@/assistant/context/store";

// Source: Ministry of Railways, PIB release 1852502 (17 Aug 2022),
// quoting circular 06.03.2020. Policy guidance, NOT a provider fare quote.
const RULE = "Children under 5 years travel free and need no ticket if no separate seat/berth is requested. If a separate seat/berth is requested, full adult fare applies. Berth allocation is not guaranteed.";
const BERTHS = ["No Preference", "Lower", "Middle", "Upper", "Side Lower", "Side Upper"];

export default function PassengersPage() {
  const [cid, setCid] = useState<string | null>(null);
  const [snap, setSnap] = useState<PassengerFormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const revision = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const load = useCallback(async () => {
    const version = revision.current;
    const id = new URLSearchParams(window.location.search).get("c") || (() => {
      try { return localStorage.getItem("railsaarthi.cid"); } catch { return null; }
    })();
    setCid(id || "");
    if (!id) return;
    try {
      const res = await fetch(`/api/passenger?conversationId=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Passenger details load nahi hue. Retry karein.");
      const data = await res.json() as PassengerFormState;
      if (revision.current === version) setSnap(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Network error"); }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const focus = () => void load();
    window.addEventListener("focus", focus);
    return () => { clearTimeout(first); window.removeEventListener("focus", focus); };
  }, [load]);

  // Serialized manual writes: stale fetches cannot overwrite newer edits;
  // review stays locked until every write is acknowledged by the backend.
  const save = (body: Record<string, unknown>) => {
    revision.current += 1;
    setPending((n) => n + 1);
    setError(null);
    queue.current = queue.current.then(async () => {
      try {
        const res = await fetch("/api/passenger", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId: cid, ...body }),
        });
        const data = await res.json() as PassengerFormState & { ok: boolean; error?: string };
        if (!res.ok || !data.ok) throw new Error(data.error || "Save nahi hua.");
        setSnap(data);
        setDirty(false);
      } catch (e) { setError(e instanceof Error ? e.message : "Save failed. Retry karein."); }
      finally { setPending((n) => n - 1); }
    });
  };

  const receive = useCallback((state: PassengerFormState) => {
    revision.current += 1;
    setSnap(state); // SAME SSE event as successful UPDATE_PASSENGER — no polling delay
  }, []);

  const selected = snap?.selection;
  const passengers = snap?.passengers.length ? snap.passengers : [{}];
  const ready = snap?.readiness?.ready === true && !pending && !dirty && !error && !assistantBusy;
  const field = (index: number, name: string, value: string) => save({ passengerIndex: index + 1, field: name, value });
  const add = (category: PassengerCategory) => save({ action: "add", category });

  return (
    <main className="min-h-screen bg-cream-100 px-4 py-6" data-testid="passenger-page">
      <div className="mx-auto max-w-3xl space-y-5 rounded-2xl border border-cream-300 bg-white p-5 shadow-sm">
        <nav className="text-xs text-navy-500">1. Train &amp; class → <strong>2. Passenger Details</strong> → 3. Review</nav>
        <h1 className="text-2xl font-bold text-navy-800">Passenger Details</h1>
        {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error} <button onClick={() => void load()}>Reload</button></div>}
        {cid === "" ? <p>Conversation nahi mili. <Link href="/chat">Chat par wapas</Link></p> : !snap ? <p>Loading passenger details…</p> : !selected?.classCode ? <p>Pehle train aur class select karein. <Link href="/chat">Chat par wapas</Link></p> : <>
          <p className="rounded-lg bg-cream-100 p-3 text-sm">{selected.trainNumber} {selected.trainName} · {selected.from} → {selected.to} · {selected.journeyDate} · {selected.classCode}</p>
          <fieldset disabled={assistantOpen} className="space-y-4">
          {passengers?.map((p, i) => <section key={i} data-testid={`passenger-card-${i}`} className="rounded-xl border border-cream-300 p-4">
            <h2 className="mb-3 font-semibold">Passenger {i + 1}{p.category === "infant_without_berth" ? " · Infant (no berth — free)" : p.category === "infant_with_berth" ? " · Infant (berth — full fare)" : ""}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <DraftInput id={`name-${i}`} label="Full Name (as per Govt. ID)" value={p.name || ""} onDirty={() => setDirty(true)} onSave={(v) => field(i, "name", v)} />
              <DraftInput id={`age-${i}`} label="Age in completed years on journey date (0 = under 1)" numeric value={p.age === undefined ? "" : String(p.age)} onDirty={() => setDirty(true)} onSave={(v) => field(i, "age", v)} />
              <label>Gender<select className="pax-input" data-testid={`gender-${i}`} value={p.gender || ""} onChange={(e) => field(i, "gender", e.target.value)}><option value="" disabled>Select Gender</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></label>
              <label>Nationality<select className="pax-input" data-testid={`nationality-${i}`} value={p.nationality || ""} onChange={(e) => field(i, "nationality", e.target.value)}><option value="" disabled>Select nationality</option>{["India", "Nepal", "Bhutan", "Bangladesh", "Other"].map((v) => <option key={v}>{v}</option>)}</select></label>
              <label>Passenger type<select className="pax-input" data-testid={`category-${i}`} value={p.category || "passenger"} onChange={(e) => field(i, "category", e.target.value)}><option value="passenger">Passenger</option><option value="infant_with_berth">Under 5 — separate berth requested</option><option value="infant_without_berth">Under 5 — without separate berth</option></select></label>
              <label>Berth preference{p.category === "infant_without_berth" ? <p data-testid={`berth-${i}`} className="pax-input">Not applicable — no separate berth requested.</p> : <select className="pax-input" data-testid={`berth-${i}`} value={p.berth || ""} onChange={(e) => field(i, "berth", e.target.value)}><option value="" disabled>Select Preference</option>{p.berth && !BERTHS.includes(p.berth) && <option>{p.berth}</option>}{BERTHS.map((v) => <option key={v}>{v}</option>)}</select>}</label>
            </div>
          </section>)}
          <div className="flex flex-wrap gap-3 text-sm font-semibold text-navy-600">
            <button disabled={!!pending || dirty} data-testid="add-passenger" onClick={() => add("passenger")}>+ Add Passenger</button>
            <button disabled={!!pending || dirty} data-testid="add-infant-with-berth" onClick={() => add("infant_with_berth")}>+ Add Infant With Berth</button>
            <button disabled={!!pending || dirty} data-testid="add-infant-without-berth" onClick={() => add("infant_without_berth")}>+ Add Infant Without Berth</button>
          </div>
          </fieldset>
          <p data-testid="children-rule-note" className="rounded-lg bg-cream-100 p-3 text-sm">{RULE} <a className="underline" href="https://pib.gov.in/PressReleasePage.aspx?PRID=1852502" target="_blank" rel="noreferrer">Official railway rule</a></p>
          <p className="text-xs">Preparation only. Policy guidance is not a fare quote. Existing limit: 6 entries per session. Food preference unsupported; berth preference is a request, not an allotment.</p>
          {snap.readiness?.blockers.map((b, i) => <p key={i} className="text-sm text-red-700">{b.detail}</p>)}
          <p role="status" className="text-sm">{pending ? "Saving…" : dirty ? "Finish editing to save." : "Saved values come from your current session."}</p>
          <div className="flex flex-wrap gap-3">
            <Link data-testid="proceed-to-review" aria-disabled={!ready} onClick={(e) => { if (!ready) e.preventDefault(); }} href={ready ? `/review?c=${encodeURIComponent(cid || "")}` : "#"} className={`rounded-lg px-4 py-3 font-bold ${ready ? "bg-navy-700 text-white" : "bg-cream-200 text-navy-400"}`}>Proceed to Review →</Link>
            <button disabled={!!pending || dirty || assistantBusy} className="rounded-lg border px-4" onClick={() => setAssistantOpen((v) => !v)}>{assistantOpen ? "Close assistant" : "Fill by voice / chat"}</button>
          </div>
          {assistantOpen && cid && <section className="h-[600px] overflow-auto rounded-xl border" aria-label="Passenger assistant"><ChatClient passengerConversationId={cid} onPassengerState={receive} onBusyChange={setAssistantBusy} /></section>}
        </>}
        <Link href="/chat" className="block text-sm underline">Back to chat</Link>
        <p className="text-xs text-navy-500">Booking, payment, OTP and ticket issuance remain disabled.</p>
      </div>
      <style>{`.pax-input{display:block;width:100%;margin-top:.35rem;border:1px solid #d8d2c4;border-radius:.6rem;padding:.7rem;background:white;color:#22304d}label{font-size:.85rem}button:disabled{opacity:.5;cursor:not-allowed}`}</style>
    </main>
  );
}

/** Draft text is not server state: sync successful AI writes unless editing.
 * Manual edits save on blur, not every keystroke (no racing POSTs or truncation). */
function DraftInput({ id, label, value, numeric, onSave, onDirty }: { id: string; label: string; value: string; numeric?: boolean; onSave: (v: string) => void; onDirty: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const editing = useRef(false);
  useEffect(() => { if (input.current && !editing.current) input.current.value = value; }, [value]);
  return <label>{label}<input ref={input} data-testid={id} className="pax-input" defaultValue={value} inputMode={numeric ? "numeric" : "text"} onFocus={() => { editing.current = true; }} onChange={onDirty} onBlur={(e) => { editing.current = false; if (e.target.value !== value) onSave(e.target.value); }} /></label>;
}
