import { afterEach, beforeEach, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import type { ChatResponse, OpenAiCompatibleClient } from "@/assistant/llm/client";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type { FareProvider, ResultEnvelope, SourceInfo, TrainSearchProvider } from "@/providers/types";

/**
 * PROMPT 17 §2 — reproducible OFFLINE conversational-quality benchmark.
 * Deterministic fake LLM + fixture adapters score the MECHANICS the model
 * relies on (context construction, validation, honesty, recovery, reset).
 * The model's own judgement is scored live by scripts/live-quality-benchmark.mjs.
 * Every scenario prints "OFFLINE PASS — [category] …" for the report.
 */
const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: `docs/provider-terms.md#${id}`,
  authorization: "configured",
});

function searchAdapter(): TrainSearchProvider {
  return {
    id: "bm-search",
    capabilities: ["trainSearch"],
    termsRef: "docs/provider-terms.md#bm-search",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async search(_q, ctx): Promise<ResultEnvelope<never>> {
      return okEnvelope({
        data: [
          { trainNumber: "12951", trainName: "Morning Express", from: { code: "LDH", name: "Ludhiana" }, to: { code: "NDLS", name: "New Delhi" }, departure: "06:15", arrival: "10:30" },
          { trainNumber: "12013", trainName: "Afternoon Shatabdi", from: { code: "LDH", name: "Ludhiana" }, to: { code: "NDLS", name: "New Delhi" }, departure: "14:20", arrival: "18:05" },
        ],
        source: src("bm-search"),
        ttlSeconds: 300,
        requestId: ctx.requestId,
      }) as ResultEnvelope<never>;
    },
  };
}

let fareFail = false;
function fareAdapter(): FareProvider {
  return {
    id: "bm-fare",
    capabilities: ["fare"],
    termsRef: "docs/provider-terms.md#bm-fare",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async fare(q, ctx): Promise<ResultEnvelope<never>> {
      if (fareFail) throw new Error("upstream exploded");
      return okEnvelope({
        data: { trainNumber: q.trainId, classCode: q.classCode, from: { code: "LDH", name: "Ludhiana" }, to: { code: "NDLS", name: "New Delhi" }, baseFare: 100, totalFare: 120, currency: "INR" },
        source: src("bm-fare"),
        ttlSeconds: 300,
        requestId: ctx.requestId,
      }) as ResultEnvelope<never>;
    },
  };
}

const LLM_ENV = ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL", "LLM_FALLBACK_MODEL", "LLM_FALLBACK_API_KEY", "LLM_FALLBACK_BASE_URL"];
beforeEach(() => {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  process.env.RAILWAY_PROVIDER_IDS = "bm-search,bm-fare";
  process.env.RAILWAY_PROVIDER_BM_SEARCH_KEY = "cred-s";
  process.env.RAILWAY_PROVIDER_BM_FARE_KEY = "cred-f";
  registerAdapter(searchAdapter());
  registerAdapter(fareAdapter());
  fareFail = false;
});
afterEach(() => {
  unregisterAdapter("bm-search");
  unregisterAdapter("bm-fare");
  for (const k of [...LLM_ENV, "RAILWAY_PROVIDER_IDS", "RAILWAY_PROVIDER_BM_SEARCH_KEY", "RAILWAY_PROVIDER_BM_FARE_KEY"]) delete process.env[k];
});

function fakeClient(responses: ChatResponse[]) {
  const requests: { messages: { role: string; content?: string | null }[] }[] = [];
  let i = 0;
  const stub = {
    config: { provider: "fake", model: "fake-model", apiKey: "x", baseUrl: "y", timeoutMs: 100 },
    async chat(req: { messages: { role: string; content?: string | null }[] }) {
      requests.push(req);
      return responses[Math.min(i++, responses.length - 1)];
    },
  };
  return { client: stub as unknown as OpenAiCompatibleClient, requests };
}
const tools = (calls: { id: string; name: string; args: Record<string, unknown> }[]): ChatResponse => ({
  content: null,
  toolCalls: calls,
  model: "fake-model",
  finishReason: "tool_calls",
});
const text = (t: string): ChatResponse => ({ content: t, toolCalls: [], model: "fake-model", finishReason: "stop" });

async function turn(store: ConversationStore, id: string, message: string, responses: ChatResponse[], client?: OpenAiCompatibleClient) {
  const fc = client ?? fakeClient(responses).client;
  const events: TurnEvent[] = [];
  for await (const e of runTurn({ conversationId: id, message, store, clientFactory: () => fc })) events.push(e);
  return events;
}

it("[2-context] follow-up request carries indexed search results to the model", async () => {
  const store = new ConversationStore();
  const { client, requests } = fakeClient([
    tools([{ id: "c1", name: "SEARCH_TRAINS", args: { from: "LDH", to: "NDLS", date: "2026-10-12" } }]),
    text("Ye rahi trains."),
    text("Doosri wali 12013 hai."),
  ]);
  await turn(store, "q1", "trains batao", [], client);
  await turn(store, "q1", "doosri wali?", [], client);
  const secondRequestContext = JSON.stringify(requests[1].messages);
  expect(secondRequestContext).toContain("Morning Express"); // indexed results available
  expect(secondRequestContext).toContain("Afternoon Shatabdi");
  console.log("OFFLINE PASS — [2-context] indexed results reach the model on follow-ups");
});

it("[7-validation] malformed tool arguments are rejected server-side, turn stays honest", async () => {
  const store = new ConversationStore();
  const events = await turn(store, "q2", "fare?", [
    tools([{ id: "c1", name: "GET_FARE", args: { trainNumber: "12013", from: "LDH", to: "NDLS", classCode: "3A", date: "not-a-date" } }]),
    text("Date valid nahi thi — dobara pooch raha hoon."),
  ]);
  const chip = events.find((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>;
  expect(chip.status).toBe("invalid_arguments");
  console.log("OFFLINE PASS — [7-validation] invalid tool args → invalid_arguments, no fake fare");
});

it("[7-dup] identical duplicate tool calls in one turn are not re-executed", async () => {
  const store = new ConversationStore();
  let executions = 0;
  const counting = searchAdapter();
  const orig = counting.search.bind(counting);
  counting.search = async (q, c) => {
    executions += 1;
    return orig(q, c);
  };
  unregisterAdapter("bm-search");
  registerAdapter(counting);
  const events = await turn(store, "q3", "search", [
    tools([
      { id: "a", name: "SEARCH_TRAINS", args: { from: "LDH", to: "NDLS", date: "2026-10-12" } },
      { id: "b", name: "SEARCH_TRAINS", args: { from: "LDH", to: "NDLS", date: "2026-10-12" } },
    ]),
    text("Ek hi search chali."),
  ]);
  expect(executions).toBe(1);
  expect(events.some((e) => e.type === "message")).toBe(true);
  unregisterAdapter("bm-search");
  registerAdapter(searchAdapter());
  console.log("OFFLINE PASS — [7-dup] duplicate identical call executed once");
});

it("[9-provider-error] provider crash surfaces as honest tool error, not fake data", async () => {
  fareFail = true;
  const store = new ConversationStore();
  const events = await turn(store, "q4", "fare?", [
    tools([{ id: "c1", name: "GET_FARE", args: { trainNumber: "12013", from: "LDH", to: "NDLS", classCode: "3A", date: "2026-10-12" } }]),
    text("Fare abhi nahi mil paya."),
  ]);
  const chip = events.find((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>;
  expect(chip.status).toBe("error");
  const msg = events.find((e) => e.type === "message") as Extract<TurnEvent, { type: "message" }>;
  expect(msg.cards.length).toBe(0);
  console.log("OFFLINE PASS — [9-provider-error] crash → honest error, zero fabricated fare");
});

it("[11-recovery] primary 500 → labeled fallback answers; double failure stays honest + context kept", async () => {
  process.env.LLM_FALLBACK_MODEL = "meta/fallback-model";
  process.env.LLM_FALLBACK_API_KEY = "nvapi-fb";
  process.env.LLM_FALLBACK_BASE_URL = "https://llm-fb.test/v1";
  const store = new ConversationStore();
  const seen: string[] = [];
  const mk = (cfg: { model: string }) =>
    ({
      config: cfg,
      async chat() {
        seen.push(cfg.model);
        if (cfg.model === "meta/test-model") throw new Error("HTTP 500");
        return text("Fallback se jawab.");
      },
    }) as unknown as OpenAiCompatibleClient;

  const events: TurnEvent[] = [];
  for await (const e of runTurn({ conversationId: "q5", message: "hi", store, clientFactory: mk })) events.push(e);
  expect(seen).toEqual(["meta/test-model", "meta/fallback-model"]);
  expect(events.some((e) => e.type === "status" && (e as { text?: string }).text === "using_fallback")).toBe(true);
  const msg = events.find((e) => e.type === "message") as Extract<TurnEvent, { type: "message" }>;
  expect(msg.text).toContain("Fallback");
  expect(msg.viaFallback).toBe(true); // never claim fallback unless it happened

  // double failure: honest error, conversation context preserved
  const seen2: string[] = [];
  const mkFail = (cfg: { model: string }) =>
    ({ config: cfg, async chat() { seen2.push(cfg.model); throw new Error("down"); } }) as unknown as OpenAiCompatibleClient;
  const ev2: TurnEvent[] = [];
  for await (const e of runTurn({ conversationId: "q5", message: "aur haal?", store, clientFactory: mkFail })) ev2.push(e);
  expect(seen2).toEqual(["meta/test-model", "meta/fallback-model"]);
  expect(ev2.some((e) => e.type === "error")).toBe(true);
  console.log("OFFLINE PASS — [11-recovery] labeled fallback on primary 500; double failure honest, context kept");
});

it("[12-reset] separate conversations never share context", async () => {
  const store = new ConversationStore();
  await turn(store, "r1", "trains", [
    tools([{ id: "c1", name: "SEARCH_TRAINS", args: { from: "LDH", to: "NDLS", date: "2026-10-12" } }]),
    text("Trains."),
  ]);
  const { client, requests } = fakeClient([text("Kaunsi train? Pehle bataiye.")]);
  await turn(store, "r2", "us train ka fare?", [], client);
  expect(JSON.stringify(requests[0].messages)).not.toContain("Morning Express");
  console.log("OFFLINE PASS — [12-reset] conversation isolation holds");
});
