/**
 * PROMPT 17 §2/§3 — conversational quality benchmark (LIVE, quota-conscious:
 * ~12 LLM turns). Real LLM + real providers; no fixtures.
 *
 *   node scripts/live-quality-benchmark.mjs   (server w/ LLM+providers :3100)
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const results = [];
const check = (cat, name, ok, detail = "") => {
  results.push({ cat, name, ok });
  console.log(`${ok ? "LIVE PASS" : "LIVE FAIL"} — [${cat}] ${name}${detail ? ` | ${detail}` : ""}`);
};
const PROVIDER_TOOLS = ["SEARCH_TRAINS", "GET_FARE", "CHECK_AVAILABILITY", "GET_TIMETABLE", "TRACK_TRAIN"];

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
  return {
    text: events.filter((e) => e.type === "message").map((e) => e.text ?? "").join(" "),
    tools: events.filter((e) => e.type === "tool_call").map((e) => e.tool),
    err: events.find((e) => e.type === "error"),
  };
}

const A = `bm-a-${Date.now()}`;

// 1 Hindi (Devanagari) understanding + live tool selection
const s1 = await turn(A, "कल लुधियाना से दिल्ली की ट्रेनें बताओ।");
const nums = [...s1.text.matchAll(/\b(\d{5})\b/g)].map((m) => m[1]);
check("1-hindi", "Devanagari search understood", !s1.err && s1.tools.includes("SEARCH_TRAINS") && nums.length > 0, `n=${nums.length}`);

// 3 reference to displayed results (Hindi)
const s2 = await turn(A, "दूसरी वाली ट्रेन कौन सी है?");
check("3-reference", "'दूसरी वाली' resolves to 2nd card", !s2.err && nums[1] && s2.text.includes(nums[1]), `expect ${nums[1]}`);

// 2 multi-turn context + 7 tool selection (Hinglish)
const s3 = await turn(A, "Uska 3A fare batao.");
check("2-context", "fare reuses train from context", !s3.err && s3.tools.includes("GET_FARE") && nums.some((n) => s3.text.includes(n)), "");

// 1 language switch + tool selection
const s4 = await turn(A, "Is CC seat available?");
check("1-langswitch", "English switch keeps context, checks availability", !s4.err && s4.tools.includes("CHECK_AVAILABILITY") && nums.some((n) => s4.text.includes(n)), "");

// 5 journey correction / date change
const s5 = await turn(A, "Date 25 Oct kar do.");
check("5-correction", "new date authoritative", !s5.err && /25[ -]?(oct|october)|2026-10-25/i.test(s5.text), "");

// 4 clarification for missing info
const B = `bm-b-${Date.now()}`;
const s6 = await turn(B, "Mujhe train dikha do.");
check("4-clarify", "asks missing details, no blind search", !s6.err && !s6.tools.includes("SEARCH_TRAINS") && !/\d{5}/.test(s6.text), "");

// 6+8 general knowledge, zero provider calls
const C = `bm-c-${Date.now()}`;
const s7 = await turn(C, "RAC aur waitlist mein kya farak hai?");
check("6-knowledge", "general answer", !s7.err && /rac/i.test(s7.text) && /waitlist|wl/i.test(s7.text), "");
check("8-no-calls", "no provider calls for knowledge", !s7.tools.some((t) => PROVIDER_TOOLS.includes(t)), s7.tools.join(","));

// 10 honest uncertainty: unsupported capability must not fabricate
const D = `bm-d-${Date.now()}`;
const s8 = await turn(D, "PNR 1234567890 ka status bata do.");
const pnrFabricated = /(CNF|CONFIRMED|status:)/i.test(s8.text) && !s8.tools.includes("CHECK_PNR");
check("10-honesty", "PNR (not configured) explained honestly", !s8.err && !pnrFabricated && /available nahi|configured|nahi kar sak|not.*available|abhi/i.test(s8.text), s8.tools.join(","));

// 5b overclaim probe: no context, asks certainty
const E = `bm-e-${Date.now()}`;
const s9 = await turn(E, "12014 me kal seat pakki hai kya?");
const overclaim = /pakki|guaranteed|confirm ho gayi|definitely/i.test(s9.text) && !s9.tools.some((t) => PROVIDER_TOOLS.includes(t));
check("10-overclaim", "no confirmation claim without live check", !s9.err && !overclaim, s9.tools.join(","));

// 5c conflicting correction before any search: latest wins
const F = `bm-f-${Date.now()}`;
await turn(F, "Ludhiana se Delhi ki trains?");
const s10 = await turn(F, "Nahi nahi — Amritsar se Delhi chahiye.");
check("5-conflict", "latest instruction authoritative", !s10.err && /(amritsar|ASR)/i.test(s10.text), "");

// 11 tone/conciseness: no internal jargon leakage
const jargon = /correlationId|tool_call|provider id|requestId|envelope/i.test(s7.text + s3.text + s8.text);
check("11-tone", "no internal jargon in user-facing text", !jargon, "");

// 12 reset: fresh conversation must not reuse other convo's train
const G = `bm-g-${Date.now()}`;
const s12 = await turn(G, "Us train ka fare batao.");
check("12-reset", "no cross-conversation context leak", !s12.err && !nums.some((n) => s12.text.includes(n)), "");

const fails = results.filter((r) => !r.ok);
console.log(`\nBENCHMARK: ${results.length - fails.length}/${results.length} live checks passed (sample: ${results.length} checks over ~12 LLM turns).`);
process.exit(fails.length ? 1 : 0);
