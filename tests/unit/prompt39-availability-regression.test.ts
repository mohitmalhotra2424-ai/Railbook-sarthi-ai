import { afterEach, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import type { ChatResponse, OpenAiCompatibleClient } from "@/assistant/llm/client";
import { executeTool } from "@/assistant/tools/executor";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type { ResultEnvelope, SourceInfo, TrainSearchProvider } from "@/providers/types";

/**
 * PROMPT 39 — REGRESSION suite on top of the verified Prompt 38 baseline
 * (code f3a52ca). Proves that:
 *  1. natural-language filtering and follow-up requests keep triggering REAL
 *     provider availability checks whenever availability matters (new class,
 *     combined filters, newer search), and
 *  2. unknown outcomes (error / rate-limit / timeout / stale / unpublished)
 *     are NEVER turned into unavailable — counts stay exact and incomplete
 *     verification is never reported as "no trains available".
 * Mock adapter — deterministic unit evidence only; it never proves live
 * provider behaviour (live evidence lives in the Prompt 38 report).
 * Prompt 38's own suite (prompt38-availability.test.ts) is untouched.
 */

const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: `docs/provider-terms.md#${id}`,
  authorization: "configured",
});

const pad = (n: number) => String(n).padStart(2, "0");

// 8 trains; every one runs 3A + SL so both classes are always relevant.
const ROWS = Array.from({ length: 8 }, (_, i) => ({
  trainNumber: String(94001 + i),
  trainName: `Regression Express ${i + 1}`,
  from: { code: "LDH", name: "Ludhiana" },
  to: { code: "NDLS", name: "Delhi" },
  departure: `${pad(5 + i)}:15`,
  arrival: `${pad(9 + i)}:45`, // 09:45 … 16:45 → arrivesBefore 12:00 = first 3
  classes: ["3A", "SL"],
}));

type Cell = "ERR" | "TIMEOUT" | "RATELIMIT" | "NOCLASS" | string; // string = published status
const GRID: Record<string, Record<string, Cell>> = {
  "94001": { "3A": "AVL 18", SL: "WL 12" },
  "94002": { "3A": "WL 3", SL: "AVL 40" },
  "94003": { "3A": "ERR", SL: "AVL 9" },
  "94004": { "3A": "AVL 2", SL: "TIMEOUT" },
  "94005": { "3A": "RATELIMIT", SL: "RAC 4" },
  "94006": { "3A": "NOCLASS", SL: "REGRET" },
  "94007": { "3A": "AVL 7", SL: "AVL 3" },
  "94008": { "3A": "TIMEOUT", SL: "ERR" },
};
// 3A: available 94001/94004/94007 · unavailable 94002 · unknown 94003/94005/94006/94008
// SL: available 94002/94003/94007 · unavailable 94001/94005/94006 · unknown 94004/94008

type AvailCall = { trainId: string; date?: string; from: string; to: string; classCode?: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(grid: Record<string, Record<string, Cell>> = GRID) {
  const state = { calls: [] as AvailCall[] };
  const adapter: TrainSearchProvider & {
    availability: (q: AvailCall, ctx: { requestId: string }) => Promise<ResultEnvelope<never>>;
  } = {
    id: "p39-avail",
    capabilities: ["trainSearch", "seatAvailability"],
    termsRef: "docs/provider-terms.md#p39-avail",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async search(_q, ctx): Promise<ResultEnvelope<never>> {
      return okEnvelope({ data: ROWS, source: src("p39-avail"), ttlSeconds: 300, requestId: ctx.requestId }) as ResultEnvelope<never>;
    },
    async availability(q, ctx): Promise<ResultEnvelope<never>> {
      state.calls.push(q);
      await sleep(2);
      const cell = grid[q.trainId]?.[q.classCode ?? ""] ?? "ERR";
      const base = { source: src("p39-avail"), ttlSeconds: 300, requestId: ctx.requestId };
      if (cell === "TIMEOUT") throw new Error("simulated upstream timeout");
      if (cell === "ERR" || cell === "RATELIMIT") {
        return {
          data: null,
          ...base,
          retrievedAt: new Date().toISOString(),
          providerTimestamp: null,
          freshness: "fresh",
          errors: [{ code: cell === "RATELIMIT" ? "RATE_LIMITED" : "UPSTREAM_ERROR", message: `${cell} (simulated)`, retryable: cell === "RATELIMIT" }],
          confidence: "high",
        } as unknown as ResultEnvelope<never>;
      }
      const classes = cell === "NOCLASS" ? [] : [{ classCode: q.classCode ?? "?", status: cell, seatsText: cell, asOf: null }];
      return okEnvelope({
        data: { trainNumber: q.trainId, date: "2026-10-12", from: { code: "LDH", name: "Ludhiana" }, to: { code: "NDLS", name: "Delhi" }, classes },
        ...base,
      }) as ResultEnvelope<never>;
    },
  };
  registerAdapter(adapter as unknown as TrainSearchProvider);
  return state;
}

const ENV_KEYS = ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL", "RAILWAY_PROVIDER_IDS", "RAILWAY_PROVIDER_P39_AVAIL_KEY"];
function envOn() {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  process.env.RAILWAY_PROVIDER_IDS = "p39-avail";
  process.env.RAILWAY_PROVIDER_P39_AVAIL_KEY = "cred";
}
afterEach(() => {
  unregisterAdapter("p39-avail");
  for (const k of ENV_KEYS) delete process.env[k];
});

const scriptedClient = (script: ChatResponse[]): OpenAiCompatibleClient => {
  let n = 0;
  return {
    config: { provider: "fake", model: "fake", apiKey: "x", baseUrl: "y", timeoutMs: 5000 },
    async chat(): Promise<ChatResponse> {
      const r = script[Math.min(n, script.length - 1)];
      n += 1;
      return r;
    },
  } as unknown as OpenAiCompatibleClient;
};
const oneClient = (script: ChatResponse[]) => {
  const c = scriptedClient(script);
  return () => c;
};
const tools = (id: string, name: string, args: Record<string, unknown>): ChatResponse => ({
  content: null,
  toolCalls: [{ id, name, args }],
  model: "fake",
  finishReason: "tool_calls",
});
const text = (t: string): ChatResponse => ({ content: t, toolCalls: [], model: "fake", finishReason: "stop" });

async function drain(run: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of run) out.push(e);
  return out;
}
const turn = (store: ConversationStore, cid: string, message: string, script: ChatResponse[]) =>
  drain(runTurn({ conversationId: cid, message, store, clientFactory: oneClient(script) }));
const searchTurn = (store: ConversationStore, cid: string, id = "s1") =>
  turn(store, cid, "trains dikhao", [tools(id, "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-12" }), text("Ye trains hain.")]);
const cardsOf = (ev: TurnEvent[]) => {
  const message = ev.find((e) => e.type === "message") as Extract<TurnEvent, { type: "message" }>;
  return message.cards ?? [];
};
const exec = (store: ConversationStore, cid: string, args: Record<string, unknown>) =>
  executeTool("FILTER_TRAINS", args, undefined, { conversationId: cid, turnId: "t", toolCallId: "c", store });

it("NL 'confirmed seats' request triggers REAL provider checks for every relevant train — not a recorded-refs filter", async () => {
  envOn();
  const state = setup();
  const store = new ConversationStore();
  await searchTurn(store, "p39-1");
  // The LLM's chosen tool for "sirf confirmed seats wali trains dikhao":
  const ev = await turn(store, "p39-1", "Sirf 3A mein confirmed seats wali trains dikhao", [
    tools("f1", "FILTER_TRAINS", { classCode: "3A", availableOnly: true }),
    text("ok"),
  ]);
  expect(state.calls).toHaveLength(8); // every relevant train checked live
  expect(state.calls.every((c) => c.classCode === "3A" && c.date === "2026-10-12" && c.from === "LDH" && c.to === "NDLS")).toBe(true);
  expect(cardsOf(ev).map((c) => c.trainNumber)).toEqual(["94001", "94004", "94007"]); // only provider-confirmed
});

it("follow-up in a different class re-checks live — earlier class outcomes never leak into the new class view", async () => {
  envOn();
  const state = setup();
  const store = new ConversationStore();
  await searchTurn(store, "p39-2");
  await turn(store, "p39-2", "3A confirmed dikhao", [tools("f1", "FILTER_TRAINS", { classCode: "3A", availableOnly: true }), text("ok")]);
  expect(state.calls).toHaveLength(8);
  const ev = await turn(store, "p39-2", "Ab sleeper mein confirmed seats dikhao", [
    tools("f2", "FILTER_TRAINS", { classCode: "SL", availableOnly: true }),
    text("ok"),
  ]);
  expect(state.calls).toHaveLength(16); // SL follow-up = 8 fresh live checks
  expect(state.calls.slice(8).every((c) => c.classCode === "SL")).toBe(true);
  // SL-confirmed only (94002/94003/94007) — NOT the 3A winners (94001/94004 absent)
  expect(cardsOf(ev).map((c) => c.trainNumber)).toEqual(["94002", "94003", "94007"]);
  expect(cardsOf(ev).every((c) => c.availability?.[0]?.classCode === "SL")).toBe(true);
});

it("follow-up combining availability with a time filter checks only the filtered-relevant subset and keeps unknown counts exact", async () => {
  envOn();
  const state = setup();
  const store = new ConversationStore();
  await searchTurn(store, "p39-3");
  // "subah 12 baje se pehle pahunchne wali confirmed 3A trains" → both constraints in one call
  const res = await exec(store, "p39-3", { classCode: "3A", availableOnly: true, arrivesBefore: "12:00" });
  expect(res.status).toBe("ok");
  expect(state.calls.map((c) => c.trainId)).toEqual(["94001", "94002", "94003"]); // only arrivals < 12:00 checked
  const data = (res.data as { trainNumber: string }[] | null) ?? [];
  expect(data.map((r) => r.trainNumber)).toEqual(["94001"]); // 94002 WL excluded, 94003 ERR = unknown, excluded
  expect(res.note).toContain("3 trains checked: 1 available, 1 unavailable, 1 could not be verified. Results are partial.");
});

it("unknown outcomes are never counted or shown as unavailable — exact three-state partition holds through the NL flow", async () => {
  envOn();
  setup();
  const store = new ConversationStore();
  await searchTurn(store, "p39-4");
  const res = await exec(store, "p39-4", { classCode: "3A", availableOnly: true });
  // GRID 3A: 3 available · 1 unavailable (94002 WL) · 4 unknown (ERR/RATELIMIT/NOCLASS/TIMEOUT)
  expect(res.note).toContain("8 trains checked: 3 available, 1 unavailable, 4 could not be verified. Results are partial.");
  expect(res.note).not.toContain("5 unavailable"); // unknowns must NOT inflate the unavailable count
  const data = (res.data as { trainNumber: string }[] | null) ?? [];
  expect(data.map((r) => r.trainNumber)).toEqual(["94001", "94004", "94007"]);
});

it("when every check fails the answer is 'could not verify' — never 'no trains available'", async () => {
  envOn();
  const allErr: Record<string, Record<string, Cell>> = {};
  for (const r of ROWS) allErr[r.trainNumber] = { "3A": "ERR", SL: "RATELIMIT" };
  setup(allErr);
  const store = new ConversationStore();
  await searchTurn(store, "p39-5");
  const res = await exec(store, "p39-5", { classCode: "3A", availableOnly: true });
  expect(res.status).toBe("ok"); // honest partial state, not a tool error
  expect(res.note).toContain("could not be verified for any of the 8 relevant trains");
  expect(res.note).toContain("Do NOT tell the user that no train is available");
  const data = (res.data as unknown[] | null) ?? [];
  expect(data).toHaveLength(0);
});

it("follow-up without refresh re-checks ONLY the previously unverifiable trains — confirmed outcomes are reused, unknowns stay unknown", async () => {
  envOn();
  const state = setup();
  const store = new ConversationStore();
  await searchTurn(store, "p39-6");
  await turn(store, "p39-6", "3A confirmed dikhao", [tools("f1", "FILTER_TRAINS", { classCode: "3A", availableOnly: true }), text("ok")]);
  expect(state.calls).toHaveLength(8);
  const ev = await turn(store, "p39-6", "Phir se 3A confirmed trains dikhao", [
    tools("f2", "FILTER_TRAINS", { classCode: "3A", availableOnly: true }),
    text("ok"),
  ]);
  expect(state.calls).toHaveLength(12); // 8 + exactly the 4 unverifiable trains retried once
  expect(state.calls.slice(8).map((c) => c.trainId).sort()).toEqual(["94003", "94005", "94006", "94008"]);
  expect(cardsOf(ev).map((c) => c.trainNumber)).toEqual(["94001", "94004", "94007"]); // unchanged honest result
});

it("a stale recorded check never counts as confirmed when the live check cannot verify the train", async () => {
  envOn();
  setup();
  const store = new ConversationStore();
  await searchTurn(store, "p39-7");
  // A previously recorded 3A check for 94003 that is now STALE (grid says ERR live)
  store.beginTurn("p39-7", "t-old", "availability");
  store.recordToolResult(
    "p39-7",
    "t-old",
    "CHECK_AVAILABILITY",
    { trainNumber: "94003", from: "LDH", to: "NDLS", date: "2026-10-12", classCode: "3A" },
    {
      tool: "CHECK_AVAILABILITY",
      correlationId: "old",
      status: "stale",
      note: "old check",
      data: { classes: [{ classCode: "3A", status: "AVAILABLE-5" }] },
      source: { providerId: "p39-avail", authorization: "configured" },
      retrievedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      freshness: "stale",
    },
  );
  const res = await exec(store, "p39-7", { classCode: "3A", availableOnly: true });
  const data = (res.data as { trainNumber: string }[] | null) ?? [];
  expect(data.map((r) => r.trainNumber)).toEqual(["94001", "94004", "94007"]); // 94003 NOT resurrected as available
  expect(res.note).toContain("4 could not be verified"); // it stayed unknown, not available, not unavailable
});

it("a newer search invalidates the stored batch — the next availability request checks everything live again", async () => {
  envOn();
  const state = setup();
  const store = new ConversationStore();
  await searchTurn(store, "p39-8", "s1");
  await turn(store, "p39-8", "3A confirmed dikhao", [tools("f1", "FILTER_TRAINS", { classCode: "3A", availableOnly: true }), text("ok")]);
  expect(state.calls).toHaveLength(8);
  // Newer search for the SAME route/date = new result version → old batch dies with it
  await searchTurn(store, "p39-8", "s2");
  const ev = await turn(store, "p39-8", "Ab confirmed 3A trains dikhao", [
    tools("f2", "FILTER_TRAINS", { classCode: "3A", availableOnly: true }),
    text("ok"),
  ]);
  expect(state.calls).toHaveLength(16); // no reuse across search versions
  expect(cardsOf(ev).map((c) => c.trainNumber)).toEqual(["94001", "94004", "94007"]);
});
