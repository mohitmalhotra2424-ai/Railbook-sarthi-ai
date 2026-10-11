import { afterEach, beforeEach, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import type { ChatResponse, OpenAiCompatibleClient } from "@/assistant/llm/client";
import { errorEnvelope, okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type { ResultEnvelope, SourceInfo, TrainSearchProvider } from "@/providers/types";

/**
 * PROMPT 20 — load resilience & resource control.
 * Fully deterministic: a scripted LLM client (no live calls) and a fixture
 * provider with test-controlled latency / failure injection.
 */

const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: `docs/provider-terms.md#${id}`,
  authorization: "configured",
});

/** Fixture adapter: configurable delay + failure injection. */
function makeAdapter(opts: { delayMs?: number; failFor?: (q: { to?: string }) => boolean }) {
  let failNext = false;
  const adapter: TrainSearchProvider & { failNext: () => void } = {
    id: "lr-search",
    capabilities: ["trainSearch"],
    termsRef: "docs/provider-terms.md#lr-search",
    failNext: () => {
      failNext = true;
    },
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async search(q, ctx): Promise<ResultEnvelope<never>> {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      const shouldFail = failNext || opts.failFor?.(q as { to?: string });
      if (shouldFail) {
        return errorEnvelope({
          source: src("lr-search"),
          errors: [{ code: "UPSTREAM_ERROR", message: "injected provider failure", retryable: true }],
          requestId: ctx.requestId,
        }) as ResultEnvelope<never>;
      }
      return okEnvelope({
        data: [
          {
            trainNumber: "12951",
            trainName: "Morning Express",
            from: { code: "LDH", name: "Ludhiana" },
            to: { code: (q as { to?: string }).to ?? "XXX", name: "Dest" },
            departure: "06:15",
            arrival: "10:30",
          },
        ],
        source: src("lr-search"),
        ttlSeconds: 300,
        requestId: ctx.requestId,
      }) as ResultEnvelope<never>;
    },
  };
  return adapter;
}

/** Scripted LLM: exactly one SEARCH_TRAINS tool call, then the final text. */
function scriptedClient(target = "T1") {
  let n = 0;
  const stub = {
    config: { provider: "fake", model: "fake", apiKey: "x", baseUrl: "y", timeoutMs: 5000 },
    async chat(): Promise<ChatResponse> {
      n += 1;
      if (n === 1) {
        return {
          content: null,
          toolCalls: [{ id: `c${n}`, name: "SEARCH_TRAINS", args: { from: "LDH", to: target, date: "2026-10-12" } }],
          model: "fake",
          finishReason: "tool_calls",
        };
      }
      return { content: `answer-${target}`, toolCalls: [], model: "fake", finishReason: "stop" };
    },
  };
  return stub as unknown as OpenAiCompatibleClient;
}

/** One-shot text-only LLM client. */
function textClient(tag: string) {
  const stub = {
    config: { provider: "fake", model: "fake", apiKey: "x", baseUrl: "y", timeoutMs: 5000 },
    async chat(): Promise<ChatResponse> {
      return { content: `answer-${tag}`, toolCalls: [], model: "fake", finishReason: "stop" };
    },
  };
  return stub as unknown as OpenAiCompatibleClient;
}

const LLM_ENV = ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL", "RAILWAY_PROVIDER_IDS", "RAILWAY_PROVIDER_LR_SEARCH_KEY"];
let adapter: ReturnType<typeof makeAdapter> | null = null;
beforeEach(() => {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  process.env.RAILWAY_PROVIDER_IDS = "lr-search";
  process.env.RAILWAY_PROVIDER_LR_SEARCH_KEY = "cred";
  adapter = makeAdapter({});
  registerAdapter(adapter);
});
afterEach(() => {
  unregisterAdapter("lr-search");
  for (const k of LLM_ENV) delete process.env[k];
});

async function drain(run: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of run) out.push(e);
  return out;
}

it("L1: 12 independent conversations under concurrent load stay isolated and all complete", async () => {
  const store = new ConversationStore();
  const turns = Array.from({ length: 12 }, (_, i) =>
    drain(
      runTurn({
        conversationId: `load-${String(i).padStart(2, "0")}`,
        message: `Trains to T${i}`,
        store,
        clientFactory: () => textClient(String(i)),
      }),
    ),
  );
  const results = await Promise.all(turns);
  expect(results).toHaveLength(12);
  for (const ev of results) expect(ev.some((e) => e.type === "message")).toBe(true);
  for (let i = 0; i < 12; i++) {
    const msgs = store.getOrCreate(`load-${String(i).padStart(2, "0")}`).messages;
    const assistant = msgs.filter((m) => m.role === "assistant").map((m) => m.content).join("|");
    expect(assistant).toBe(`answer-${i}`); // only its own answer
  }
  expect(store.getOrCreate("load-00").messages.map((m) => m.content).join()).not.toContain("answer-1|");
});

it("L2: five sequential turns in one conversation keep history bounded and ordered", async () => {
  const store = new ConversationStore();
  for (let i = 0; i < 5; i++) {
    const ev = await drain(
      runTurn({ conversationId: "seq-conv", message: `q${i}`, store, clientFactory: () => textClient(`t${i}`) }),
    );
    expect(ev.some((e) => e.type === "message")).toBe(true);
  }
  const msgs = store.getOrCreate("seq-conv").messages;
  expect(msgs).toHaveLength(10); // 5 user + 5 assistant
  expect(msgs.filter((m) => m.role === "user").map((m) => m.content)).toEqual(["q0", "q1", "q2", "q3", "q4"]);
});

it("L3: slow provider (250 ms) — 6 concurrent tool turns finish in parallel, no cross-talk", async () => {
  const turnClients: OpenAiCompatibleClient[] = [];
  unregisterAdapter("lr-search");
  registerAdapter(makeAdapter({ delayMs: 250 }));
  const store = new ConversationStore();
  const started = Date.now();
  const turns = Array.from({ length: 6 }, (_, i) =>
    drain(
      runTurn({ conversationId: `slow-${i}`, message: `to T${i}`, store, clientFactory: () => (turnClients[i] ??= scriptedClient(`T${i + 1}`)) }),
    ),
  );
  const results = await Promise.all(turns);
  const elapsed = Date.now() - started;
  for (let i = 0; i < 6; i++) {
    const msg = results[i].find((e) => e.type === "message") as Extract<TurnEvent, { type: "message" }> | undefined;
    expect(msg).toBeDefined();
    // Cross-talk check: each turn's card carries ITS OWN destination code
    expect(msg!.cards.map((c) => c.to).join(",")).toContain(`T${i + 1}`);
  }
  // Parallel, not serialized: 6 × 250 ms sequential would be ≥1500 ms.
  expect(elapsed).toBeLessThan(1200);
});

it("L4: mixed success/failure — failing conversations degrade honestly without breaking others", async () => {
  unregisterAdapter("lr-search");
  registerAdapter(makeAdapter({ failFor: (q) => Boolean(q.to && Number(q.to.slice(1)) % 2 === 1) }));
  const mixClients: OpenAiCompatibleClient[] = [];
  const store = new ConversationStore();
  // scriptedClient alternates args to `T{n}` — even targets succeed, odd fail.
  const turns = Array.from({ length: 6 }, (_, i) =>
    drain(runTurn({ conversationId: `mix-${i}`, message: "search", store, clientFactory: () => (mixClients[i] ??= scriptedClient(`T${i}`)) })),
  );
  const results = await Promise.all(turns);
  for (const ev of results) {
    // Every conversation still reaches a final message — a failing provider
    // never kills the turn or another conversation.
    expect(ev.some((e) => e.type === "message")).toBe(true);
  }
  // No crash events anywhere
  for (const ev of results) expect(ev.some((e) => e.type === "error")).toBe(false);
});

it("L5: duplicate concurrent submissions in one conversation both complete without crashing", async () => {
  const store = new ConversationStore();
  const [a, b] = await Promise.all([
    drain(runTurn({ conversationId: "dup-conv", message: "same", store, clientFactory: () => textClient("a") })),
    drain(runTurn({ conversationId: "dup-conv", message: "same", store, clientFactory: () => textClient("b") })),
  ]);
  expect(a.some((e) => e.type === "message")).toBe(true);
  expect(b.some((e) => e.type === "message")).toBe(true);
  const msgs = store.getOrCreate("dup-conv").messages.filter((m) => m.role === "assistant");
  expect(msgs).toHaveLength(2); // both answers recorded, none lost
});

it("L6: store stays bounded — 250 conversations evict down to the LRU cap (200)", async () => {
  const store = new ConversationStore();
  for (let i = 0; i < 250; i++) {
    store.beginTurn(`cap-${i}`, `turn-${i}`, "hi");
  }
  // newest must survive; total bounded by MAX_CONVERSATIONS
  expect(store.get("cap-249")).toBeDefined();
  const map = (store as unknown as { conversations: Map<string, unknown> }).conversations;
  expect(map.size).toBeLessThanOrEqual(200);
});

it("L7: oversized provider response is compacted — context payload stays bounded", async () => {
  unregisterAdapter("lr-search");
  const big: TrainSearchProvider = {
    id: "lr-search",
    capabilities: ["trainSearch"],
    termsRef: "docs/provider-terms.md#lr-search",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async search(_q, ctx): Promise<ResultEnvelope<never>> {
      const rows = Array.from({ length: 5000 }, (_, i) => ({
        trainNumber: String(10000 + i),
        trainName: `Overflow Special ${i}`,
        from: { code: "LDH", name: "Ludhiana" },
        to: { code: "NDLS", name: "Delhi" },
        departure: "06:15",
        arrival: "10:30",
      }));
      return okEnvelope({
        data: rows,
        source: src("lr-search"),
        ttlSeconds: 300,
        requestId: ctx.requestId,
      }) as ResultEnvelope<never>;
    },
  };
  registerAdapter(big);

  const store = new ConversationStore();
  const bigClient = scriptedClient();
  const ev = await drain(
    runTurn({ conversationId: "big-conv", message: "search", store, clientFactory: () => bigClient }),
  );
  expect(ev.some((e) => e.type === "message")).toBe(true);
  const conv = store.getOrCreate("big-conv");
  const refs = conv.results;
  expect(refs.length).toBeLessThanOrEqual(8); // MAX_RESULT_REFS
  for (const r of refs) expect(r.items?.length ?? 0).toBeLessThanOrEqual(8); // compactItems cap
});

it("L8: primary AND fallback both failing — honest error, no fabricated railway reply", async () => {
  process.env.LLM_FALLBACK_MODEL = "openai/fallback-model";
  process.env.LLM_FALLBACK_API_KEY = "nvapi-fallback-key";
  process.env.LLM_FALLBACK_BASE_URL = "https://llm.test/v1";

  let calls = 0;
  const failing = {
    config: { provider: "fake", model: "fake", apiKey: "x", baseUrl: "y", timeoutMs: 5000 },
    async chat(): Promise<ChatResponse> {
      calls += 1;
      throw new Error("HTTP 500 (injected)");
    },
  } as unknown as OpenAiCompatibleClient;

  const store = new ConversationStore();
  const ev = await drain(
    runTurn({ conversationId: "both-fail", message: "trains?", store, clientFactory: () => failing }),
  );
  expect(calls).toBe(2); // primary then fallback — exactly the configured policy
  const err = ev.find((e) => e.type === "error");
  expect(err).toBeDefined();
  expect((err as { retryable?: boolean }).retryable).toBe(true);
  expect(ev.some((e) => e.type === "message")).toBe(false); // nothing invented
  // Semantics check: `using_fallback` status = a fallback ATTEMPT was really
  // made (it was — the call was issued and failed). The authoritative "fallback
  // was used" claim lives on the final message (`viaFallback`), which never
  // exists here — so no false success claim is made.
  const fallbackMessage = ev.find(
    (e) => e.type === "message" && (e as { viaFallback?: boolean }).viaFallback === true,
  );
  expect(fallbackMessage).toBeUndefined();
  // Conversation context preserved for the next attempt
  expect(store.getOrCreate("both-fail").messages.some((m) => m.role === "user")).toBe(true);

  delete process.env.LLM_FALLBACK_MODEL;
  delete process.env.LLM_FALLBACK_API_KEY;
  delete process.env.LLM_FALLBACK_BASE_URL;
});
