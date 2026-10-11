import { afterEach, beforeEach, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import type { ChatResponse, OpenAiCompatibleClient } from "@/assistant/llm/client";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type { ResultEnvelope, SourceInfo, TrainSearchProvider } from "@/providers/types";

/**
 * PROMPT 19 — concurrent conversations, request isolation & journey-state
 * consistency. Deterministic: LLM responses are released manually by the
 * test (no sleeps), provider is a fixture adapter.
 */
const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: `docs/provider-terms.md#${id}`,
  authorization: "configured",
});

function searchAdapter(): TrainSearchProvider {
  return {
    id: "cc-search",
    capabilities: ["trainSearch"],
    termsRef: "docs/provider-terms.md#cc-search",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async search(_q, ctx): Promise<ResultEnvelope<never>> {
      return okEnvelope({
        data: [
          { trainNumber: "12951", trainName: "Morning Express", from: { code: "LDH", name: "Ludhiana" }, to: { code: _q.to, name: "Dest" }, departure: "06:15", arrival: "10:30" },
        ],
        source: src("cc-search"),
        ttlSeconds: 300,
        requestId: ctx.requestId,
      }) as ResultEnvelope<never>;
    },
  };
}

const LLM_ENV = ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL", "RAILWAY_PROVIDER_IDS", "RAILWAY_PROVIDER_CC_SEARCH_KEY"];
beforeEach(() => {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  process.env.RAILWAY_PROVIDER_IDS = "cc-search";
  process.env.RAILWAY_PROVIDER_CC_SEARCH_KEY = "cred";
  registerAdapter(searchAdapter());
});
afterEach(() => {
  unregisterAdapter("cc-search");
  for (const k of LLM_ENV) delete process.env[k];
});

/** LLM client whose responses the test releases manually, in order. */
function manualClient() {
  type Call = { messages: { role: string; content?: string | null }[]; release: (r: ChatResponse) => void; done: Promise<ChatResponse> };
  const calls: Call[] = [];
  const stub = {
    config: { provider: "fake", model: "fake", apiKey: "x", baseUrl: "y", timeoutMs: 5000 },
    chat(req: { messages: { role: string; content?: string | null }[] }) {
      let release!: (r: ChatResponse) => void;
      const done = new Promise<ChatResponse>((res) => (release = res));
      calls.push({ messages: req.messages, release, done });
      return done;
    },
  };
  return { client: stub as unknown as OpenAiCompatibleClient, calls };
}
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
const waitUntil = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
};

it("A/B: out-of-order turns — newer turn never sees incomplete older results; both stay associated", async () => {
  const store = new ConversationStore();
  const m = manualClient();

  const t1 = drain(runTurn({ conversationId: "cc1", message: "Kal Ludhiana se Delhi", store, clientFactory: () => m.client }));
  await waitUntil(() => m.calls.length >= 1);
  m.calls[0].release(tools("c1", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-12" }));
  await waitUntil(() => m.calls.length >= 2); // turn1 awaiting final answer (provider done)

  // Start turn2 WHILE turn1 is still open
  const t2 = drain(runTurn({ conversationId: "cc1", message: "Nahi, Amritsar jaana hai", store, clientFactory: () => m.client }));
  await waitUntil(() => m.calls.length >= 3);
  // Association: if turn1's in-flight result is already recorded, it is labelled
  // with ITS route+date (LDH→NDLS) — never presented bare as current for the
  // changed journey (the supersede rule forces the LLM to re-search).
  const ctx2 = JSON.stringify(m.calls[2].messages);
  if (ctx2.includes("Morning Express")) expect(ctx2).toContain("LDH→NDLS");

  // turn1 completes AFTER turn2 started; then turn2 flows
  m.calls[1].release(text("Delhi ki trains ye hain.")); // turn1 settles late
  m.calls[2].release(tools("c2", "SEARCH_TRAINS", { from: "LDH", to: "ASR", date: "2026-10-12" }));
  await waitUntil(() => m.calls.length >= 4); // turn2's final-answer call
  // turn1's settled result is history in turn2's context, labelled with its route
  expect(JSON.stringify(m.calls[3].messages)).toContain("Morning Express");
  m.calls[3].release(text("Amritsar wali alag hai."));

  const ev1 = await t1;
  const ev2 = await t2;
  // Non-contamination: each turn's UI cards come ONLY from its own tool results
  const msg1 = ev1.find((e) => e.type === "message") as Extract<TurnEvent, { type: "message" }>;
  const msg2 = ev2.find((e) => e.type === "message") as Extract<TurnEvent, { type: "message" }>;
  expect(msg1.cards.map((c) => c.to).join(",")).toContain("NDLS");
  expect(msg2.cards.map((c) => c.to).join(",")).toContain("ASR");
  expect(msg2.cards.map((c) => c.to).join(",")).not.toContain("NDLS");

  const conv = store.getOrCreate("cc1");
  const assistantTexts = conv.messages.filter((x) => x.role === "assistant").map((x) => x.content);
  expect(assistantTexts).toContain("Delhi ki trains ye hain.");
  expect(assistantTexts).toContain("Amritsar wali alag hai.");
});

it("C: rapid follow-up reference never resolves against incomplete results", async () => {
  const store = new ConversationStore();
  const m = manualClient();
  const t1 = drain(runTurn({ conversationId: "cc2", message: "trains?", store, clientFactory: () => m.client }));
  await waitUntil(() => m.calls.length >= 1);
  // follow-up starts before turn1's tool result exists
  const t2 = drain(runTurn({ conversationId: "cc2", message: "second wali ka fare", store, clientFactory: () => m.client }));
  await waitUntil(() => m.calls.length >= 2);
  // follow-up's context: no indexed search items yet (turn1's tool not executed)
  expect(JSON.stringify(m.calls[1].messages)).not.toContain("Morning Express");
  m.calls[0].release(tools("c1", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-12" }));
  await waitUntil(() => m.calls.length >= 3);
  m.calls[2].release(text("ok"));
  m.calls[1].release(text("abhi context nahi tha — bataiye kaunsi train."));
  await t1;
  await t2;
});

it("D: abort mid-turn leaves no partial assistant message; next turn clean", async () => {
  const store = new ConversationStore();
  const m = manualClient();
  const controller = new AbortController();
  const t1 = drain(runTurn({ conversationId: "cc3", message: "hi", store, signal: controller.signal, clientFactory: () => m.client }));
  await waitUntil(() => m.calls.length >= 1);
  controller.abort();
  m.calls[0].release(text("too late"));
  const ev1 = await t1;
  expect(ev1.some((e) => e.type === "message")).toBe(false); // stale answer dropped
  expect(store.getOrCreate("cc3").messages.filter((x) => x.role === "assistant")).toHaveLength(0);

  const t2 = drain(runTurn({ conversationId: "cc3", message: "ab sahi", store, clientFactory: () => m.client }));
  await waitUntil(() => m.calls.length >= 2);
  m.calls[1].release(text("fresh answer"));
  const events = await t2;
  expect(events.some((e) => e.type === "message")).toBe(true);
  expect(store.getOrCreate("cc3").messages.filter((x) => x.role === "assistant")).toHaveLength(1);
});

it("E: separate conversations under concurrent load stay isolated", async () => {
  const store = new ConversationStore();
  const m = manualClient();
  const a = drain(runTurn({ conversationId: "iso-a", message: "Delhi", store, clientFactory: () => m.client }));
  const b = drain(runTurn({ conversationId: "iso-b", message: "Mumbai", store, clientFactory: () => m.client }));
  await waitUntil(() => m.calls.length >= 2);
  m.calls[0].release(text("A answer"));
  m.calls[1].release(text("B answer"));
  await a;
  await b;
  expect(JSON.stringify(store.getOrCreate("iso-b").messages)).not.toContain("A answer");
  expect(JSON.stringify(store.getOrCreate("iso-a").messages)).not.toContain("B answer");
});
