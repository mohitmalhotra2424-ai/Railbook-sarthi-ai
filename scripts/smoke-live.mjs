/**
 * LIVE smoke test — talks to the REAL running server (and through it, the
 * REAL configured LLM). Not part of CI. Usage: node scripts/smoke-live.mjs
 * Prints a compact, secret-free transcript of SSE events per turn.
 */
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3200";
const CID = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const turns = [
  "Ludhiana se Delhi ki trains batao (aaj 2026-10-10 hai).",
  "Kal nahi, parso ke liye dekho.",
  "Achha, WL ticket ka matlab kya hota hai?",
  "PNR 1234567890 ka status bhi bata do.",
];

async function runTurn(message) {
  console.log(`\n👤 USER: ${message}`);
  const res = await fetch(`${BASE}/api/assistant`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId: CID, message }),
  });
  if (!res.ok || !res.body) {
    console.log(`   HTTP ${res.status}`);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line.slice(6)); } catch { continue; }
      if (ev.type === "status") console.log(`   ⏳ ${ev.text}${ev.model ? ` (${ev.model})` : ""}`);
      else if (ev.type === "tool_call") console.log(`   🔧 TOOL_CALL ${ev.tool} ${ev.argsSummary}`);
      else if (ev.type === "tool_result") console.log(`   📦 TOOL_RESULT ${ev.tool} → ${ev.status}${ev.freshness ? ` (${ev.freshness})` : ""}`);
      else if (ev.type === "message") console.log(`   🤖 ASSISTANT [model=${ev.model}${ev.viaFallback ? " VIA FALLBACK" : ""}]:\n      ${ev.text.replace(/\n/g, "\n      ")}`);
      else if (ev.type === "error") console.log(`   ❌ ERROR [${ev.code}] ${ev.message}`);
    }
  }
}

console.log(`conversation: ${CID}`);
for (const t of turns) {
  await runTurn(t);
}
console.log("\nsmoke complete");
