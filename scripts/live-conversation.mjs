/**
 * PROMPT 14 §2/§3 — end-to-end natural-conversation verification.
 * Runs against a locally started server (real LLM + real providers).
 * Every PASS line below is backed by a REAL provider/LLM exchange.
 *
 *   RAILWAY_PROVIDER_IDS="confirmtkt-v1,erail-v1,web-data-v1" npx next start -p 3100 &
 *   node scripts/live-conversation.mjs
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
  const text = events.filter((e) => e.type === "message").map((e) => e.text ?? "").join(" ");
  const tools = events.filter((e) => e.type === "tool_call").map((e) => e.tool);
  const cards = events.flatMap((e) => e.cards ?? []);
  const err = events.find((e) => e.type === "error");
  return { text, tools, cards, err, events };
}

const convA = `live-a-${Date.now()}`;

// ---- Example A: search + contextual follow-ups ------------------------------
const t1 = await turn(convA, "Kal Ludhiana se Delhi ki trains batao.");
check("A1 search returns real trains", !t1.err && (t1.tools.includes("SEARCH_TRAINS") || t1.cards.length > 0), `tools=${t1.tools.join(",")}`);
const trainNums = [...t1.text.matchAll(/\b(\d{5})\b/g)].map((m) => m[1]);
check("A1 train numbers present", trainNums.length > 0, trainNums.slice(0, 3).join(","));

const t2 = await turn(convA, "Inmein sabse jaldi kaunsi pahunchegi?");
const asksRouteAgain = /kaha[nu] (se|tak)|kaunsa route|kis route/i.test(t2.text);
check("A2 resolves 'inmein' without re-asking route", !t2.err && !asksRouteAgain && trainNums.some((n) => t2.text.includes(n)), `tools=${t2.tools.join(",")}`);

const t3 = await turn(convA, "Uska 3A fare batao.");
const mentionsFare = /fare|₹|rupees/i.test(t3.text);
check("A3 fare for the contextual train", !t3.err && mentionsFare && trainNums.some((n) => t3.text.includes(n)), `tools=${t3.tools.join(",")}`);

const t4 = await turn(convA, "Seat bhi check kar do.");
const mentionsAvail = /available|waitlist|wl|rac|seat/i.test(t4.text);
check("A4 availability reuses train+route+class", !t4.err && mentionsAvail && trainNums.some((n) => t4.text.includes(n)), `tools=${t4.tools.join(",")}`);

// ---- Example E: changed journey date must not reuse old data ---------------
const t5 = await turn(convA, "Date badal do — 20 Oct ko check karo.");
const mentionsNewDate = /20[ -]?(oct|october)|2026-10-20/i.test(t5.text);
console.log("E1 TEXT:", t5.text.slice(0, 400));
check("E1 changed date honoured", !t5.err && mentionsNewDate, `tools=${t5.tools.join(",")}`);

// ---- Example B: missing info → natural clarification, no blind tool call ----
const convB = `live-b-${Date.now()}`;
const tB = await turn(convB, "Mujhe Jammu jaana hai.");
const clarified = /kaha[nu] se|origin|which (city|station)|starting|kab|kis date|which date|date/i.test(tB.text) || tB.text.trim().endsWith("?");
console.log("B1 TEXT:", tB.text.slice(0, 300));
check("B1 asks only genuinely missing info", !tB.err && clarified && !tB.tools.includes("SEARCH_TRAINS") && !/\d{5}/.test(tB.text), `tools=${tB.tools.join(",")}`);

// ---- Example C: general knowledge → no provider calls ----------------------
const convC = `live-c-${Date.now()}`;
const tC = await turn(convC, "RAC aur WL mein kya farak hai?");
const explains = /rac/i.test(tC.text) && /(waitlist|wl)/i.test(tC.text);
const PROVIDER_TOOLS = ["SEARCH_TRAINS", "GET_FARE", "CHECK_AVAILABILITY", "GET_TIMETABLE", "TRACK_TRAIN", "CHECK_PNR", "GET_TRAIN_INFO"];
check("C1 answers from knowledge, no provider calls", !tC.err && explains && !tC.tools.some((t) => PROVIDER_TOOLS.includes(t)), `tools=${tC.tools.join(",")}`);

// ---- Example D: language switch keeps context ------------------------------
const tD = await turn(convA, "What is the fare for CC class now?");
check("D1 English switch keeps journey context", !tD.err && trainNums.some((n) => tD.text.includes(n)), `tools=${tD.tools.join(",")}`);

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} live conversation checks passed.`);
process.exit(fails.length ? 1 : 0);
