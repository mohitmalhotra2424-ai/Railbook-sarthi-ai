/**
 * PROMPT 25 — controlled live verification of conversational selection +
 * passenger autofill. REAL LLM + REAL providers (clearly a live run, small N).
 *   RAILWAY_PROVIDER_IDS="confirmtkt-v1,erail-v1,web-data-v1" npx next start -p 3100 &
 *   node scripts/live-selection.mjs
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "LIVE PASS" : "LIVE FAIL"} — ${name}${detail ? ` | ${detail}` : ""}`);
};

async function turn(conversationId, message, timeoutMs = 100_000) {
  const res = await fetch(`${BASE}/api/assistant`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId, message }),
  });
  if (!res.ok || !res.body) throw new Error(`assistant HTTP ${res.status}`);
  const events = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
    }
    if (events.some((e) => e.type === "done" || e.type === "error")) break;
  }
  const forms = events.filter((e) => e.type === "passenger_form");
  const tools = events.filter((e) => e.type === "tool_result").map((e) => `${e.tool}:${e.status}`);
  const text = events.filter((e) => e.type === "message").map((e) => e.text ?? "").join(" ");
  const err = events.find((e) => e.type === "error");
  const calls = events.filter((e) => e.type === "tool_call").map((e) => `${e.tool} ${e.argsSummary}`);
  return { forms, tools, text, err, calls };
}

const cid = `p25-live-${Date.now()}`;

const t1 = await turn(cid, "Kal Ludhiana se Delhi ki trains batao.");
const firstTrain = t1.forms.length ? null : (t1.text.match(/\b(\d{5})\b/) || [])[1];
check("L1 live search returns trains", !t1.err && Boolean(firstTrain), `train=${firstTrain}`);

const t2 = await turn(cid, "Pehli wali train select karo.");
const sel2 = t2.forms.at(-1)?.selection;
check("L2 chat selection updates real state", !t2.err && t2.tools.some((t) => t.startsWith("SELECT_TRAIN:ok")) && sel2?.trainNumber === firstTrain, `sel=${sel2?.trainNumber}`);

const supported = sel2?.classes?.[0] ?? "3A";
const t3 = await turn(cid, `${supported} select karo.`);
const sel3 = t3.forms.at(-1)?.selection;
check("L3 class selection opens the form", !t3.err && sel3?.classCode === supported, `class=${sel3?.classCode} supported=${(sel2?.classes ?? []).join(",")}`);

const t4 = await turn(cid, "Passenger ka naam Rahul Sharma hai.");
const p4 = t4.forms.at(-1)?.passengers?.[0];
check("L4 name collected & validated into form", !t4.err && p4?.name === "Rahul Sharma", `pax=${JSON.stringify(p4 ?? {})}`);

const t5 = await turn(cid, "Age 28.");
const p5 = t5.forms.at(-1)?.passengers?.[0];
check("L5 age collected next, name retained", !t5.err && p5?.age === 28 && p5?.name === "Rahul Sharma", `pax=${JSON.stringify(p5 ?? {})} tools=${t5.tools.join(",")} calls=${t5.calls.join(" | ")} text=${t5.text.slice(0,120)}`);
// P26 guard: if the model did NOT record the age this turn, the delivered text
// must not claim it was saved (save-claim guard blocks the false confirmation).
const ageSavedThisTurn = t5.tools.some((s) => s.startsWith("UPDATE_PASSENGER:ok")) && p5?.age === 28;
const claimsSaved = /save ho gay|सेव हो ग|saved|save ho chuki/i.test(t5.text);
check("L5G no unsupported save claim delivered (P26 guard)", ageSavedThisTurn || !claimsSaved, `ageSaved=${ageSavedThisTurn} claimsSaved=${claimsSaved} text=${t5.text.slice(0, 140)}`);

// P29: full auto-fill chain — gender is the last required field.
const t5b = await turn(cid, "Male");
const p5b = t5b.forms.at(-1)?.passengers?.[0];
check("L5b gender collected — required field set complete (name+age+gender)", !t5b.err && p5b?.gender === "male" && p5b?.name === "Rahul Sharma", `pax=${JSON.stringify(p5b ?? {})} tools=${t5b.tools.join(",")} text=${t5b.text.slice(0, 120)}`);

// P30: final booking-review readiness — authoritative form event must carry the
// full journey (train/date/class) + every required passenger field saved.
const revSel = t5b.forms.at(-1)?.selection;
check(
  "L8 final review data complete (train+date+class+all required pax saved)",
  !t5b.err && Boolean(revSel?.trainNumber) && Boolean(revSel?.classCode) && Boolean(revSel?.journeyDate) &&
    Boolean(p5b?.name) && p5b?.age !== undefined && Boolean(p5b?.gender),
  `sel=${revSel?.trainNumber ?? "-"}/${revSel?.classCode ?? "-"}/${revSel?.journeyDate ?? "-"} paxComplete=${Boolean(p5b?.name && p5b?.age !== undefined && p5b?.gender)}`,
);

const t6 = await turn(cid, "Maine naam galat bola — Rahul nahi, Rohit Sharma hai.");
const p6 = t6.forms.at(-1)?.passengers?.[0];
check("L6 natural correction overwrites same field", !t6.err && p6?.name === "Rohit Sharma" && p6?.age === 28, `pax=${JSON.stringify(p6 ?? {})} tools=${t6.tools.join(",")}`);

const t7 = await turn(cid, "Food preference veg set kar do.");
check("L7 food unsupported — honestly refused, no invented option", !t7.err && /support|nahi|omitted|not available|disabled|no food/i.test(t7.text) && !(t7.forms.at(-1)?.passengers?.[0] && "food" in t7.forms.at(-1).passengers[0]), `tools=${t7.tools.join(",")}`);

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} live selection checks passed.`);
process.exit(fails.length ? 1 : 0);
