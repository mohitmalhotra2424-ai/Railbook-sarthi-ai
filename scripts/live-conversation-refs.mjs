/**
 * PROMPT 15 — reference resolution, journey-correction authority and
 * performance probes. Real LLM + real providers only.
 *
 *   node scripts/live-conversation-refs.mjs   (server with providers on :3100)
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "LIVE PASS" : "LIVE FAIL"} — ${name}${detail ? ` | ${detail}` : ""}`);
};

async function turn(conversationId, message, timeoutMs = 100_000) {
  const started = Date.now();
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
  const ms = Date.now() - started;
  const text = events.filter((e) => e.type === "message").map((e) => e.text ?? "").join(" ");
  const tools = events.filter((e) => e.type === "tool_call").map((e) => e.tool);
  return { text, tools, ms, err: events.find((e) => e.type === "error") };
}

const conv = `live15-${Date.now()}`;

const t1 = await turn(conv, "Kal Amritsar se Delhi ki trains batao.");
const nums = [...t1.text.matchAll(/\b(\d{5})\b/g)].map((m) => m[1]);
check("R1 search ok (perf measured)", !t1.err && nums.length >= 2, `${nums.slice(0, 3).join(",")} in ${t1.ms}ms`);

// "second wali" must resolve to nums[1], not nums[0]
const t2 = await turn(conv, "Second wali train ka fare batao.");
const second = nums[1];
check("R2 'second wali' resolves to 2nd result", !t2.err && second && t2.text.includes(second), `expect ${second} in ${t2.ms}ms`);

// "usi class" continuity — ask 3A first then reuse
const t3 = await turn(conv, "Isme 3A seat availability kya hai?");
check("R3 class set in context", !t3.err && /3A/.test(t3.text) && (second ? t3.text.includes(second) : true), `${t3.ms}ms`);
const t4 = await turn(conv, "Usi class me fare bhi bata do.");
check("R4 'usi class' reuses 3A + same train", !t4.err && /3A/.test(t4.text) && (second ? t4.text.includes(second) : true), `tools=${t4.tools.join(",")} ${t4.ms}ms`);

// journey correction: latest instruction is authoritative
const t5 = await turn(conv, "Nahi nahi — date 21 Oct kar do, wahi check karo.");
check("R5 correction: 21 Oct authoritative", !t5.err && /21[ -]?(oct|october)|2026-10-21/i.test(t5.text) && !/20[ -]?oct/i.test(t5.text), `${t5.ms}ms`);

// general knowledge mid-journey: no provider calls
const t6 = await turn(conv, "Tatkal booking kab khulti hai?");
const PROVIDER = ["SEARCH_TRAINS", "GET_FARE", "CHECK_AVAILABILITY", "GET_TIMETABLE", "TRACK_TRAIN"];
check("R6 general question → no provider calls", !t6.err && !t6.tools.some((t) => PROVIDER.includes(t)), `tools=${t6.tools.join(",")} ${t6.ms}ms`);

// follow-up after correction still uses corrected date context
const t7 = await turn(conv, "Ab uska live status batao.");
check("R7 post-correction follow-up keeps train", !t7.err && (second ? t7.text.includes(second) : true), `tools=${t7.tools.join(",")} ${t7.ms}ms`);

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} reference/correction checks passed.`);
process.exit(fails.length ? 1 : 0);
