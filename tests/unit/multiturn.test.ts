import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import type { ChatResponse, OpenAiCompatibleClient } from "@/assistant/llm/client";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type {
  FareProvider,
  ResultEnvelope,
  SourceInfo,
  TrainSearchProvider,
} from "@/providers/types";

/**
 * Multi-turn integration: REAL orchestrator + REAL store + REAL executor
 * against FIXTURE provider adapters (tests only — never live mode), with a
 * scripted fake LLM standing in for the model's decisions.
 *
 * What this proves is the MECHANICS the LLM relies on: after a search, the
 * context block contains indexed items so the model can resolve "doosri
 * wali"/"shaam wali"; date corrections supersede old results end-to-end;
 * tool failures surface honestly to the model. The reference-resolution
 * DECISION itself belongs to the LLM (verified live in phase reports).
 */

const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: `docs/provider-terms.md#${id}`,
  authorization: "configured",
});

let fareShouldFail = false;

function searchAdapter(): TrainSearchProvider {
  return {
    id: "mt-search",
    capabilities: ["trainSearch"],
    termsRef: "docs/provider-terms.md#mt-search",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async search(_q, ctx): Promise<ResultEnvelope<never>> {
      const rows = [
        { trainNumber: "12951", trainName: "Morning Express", from: { code: "LDH", name: "Ludhiana" }, to: { code: "NDLS", name: "New Delhi" }, departure: "06:15", arrival: "10:30" },
        { trainNumber: "12013", trainName: "Afternoon Shatabdi", from: { code: "LDH", name: "Ludhiana" }, to: { code: "NDLS", name: "New Delhi" }, departure: "14:20", arrival: "18:05" },
        { trainNumber: "12455", trainName: "Evening Superfast", from: { code: "LDH", name: "Ludhiana" }, to: { code: "NDLS", name: "New Delhi" }, departure: "19:40", arrival: "23:55" },
      ];
      return okEnvelope({
        data: rows,
        source: src("mt-search"),
        ttlSeconds: 300,
        requestId: ctx.requestId,
      }) as ResultEnvelope<never>;
    },
  };
}

function fareAdapter(): FareProvider {
  return {
    id: "mt-fare",
    capabilities: ["fare"],
    termsRef: "docs/provider-terms.md#mt-fare",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async fare(q, ctx): Promise<ResultEnvelope<never>> {
      if (fareShouldFail) throw new Error("upstream exploded");
      return okEnvelope({
        data: {
          trainNumber: q.trainId,
          classCode: q.classCode,
          from: { code: "LDH", name: "Ludhiana" },
          to: { code: "NDLS", name: "New Delhi" },
          baseFare: 1050,
          totalFare: 1180.5,
          currency: "INR",
        },
        source: src("mt-fare"),
        ttlSeconds: 300,
        requestId: ctx.requestId,
      }) as ResultEnvelope<never>;
    },
  };
}

const LLM_ENV = ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL"];

beforeEach(() => {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  process.env.RAILWAY_PROVIDER_IDS = "mt-search,mt-fare";
  process.env.RAILWAY_PROVIDER_MT_SEARCH_KEY = "cred-s";
  process.env.RAILWAY_PROVIDER_MT_FARE_KEY = "cred-f";
  registerAdapter(searchAdapter());
  registerAdapter(fareAdapter());
  fareShouldFail = false;
});

afterEach(() => {
  unregisterAdapter("mt-search");
  unregisterAdapter("mt-fare");
  for (const k of [
    ...LLM_ENV,
    "RAILWAY_PROVIDER_IDS",
    "RAILWAY_PROVIDER_MT_SEARCH_KEY",
    "RAILWAY_PROVIDER_MT_FARE_KEY",
  ]) {
    delete process.env[k];
  }
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
  toolCalls: calls.map((c) => ({ ...c, args: c.args })),
  model: "fake-model",
  finishReason: "tool_calls",
});
const text = (t: string): ChatResponse => ({ content: t, toolCalls: [], model: "fake-model", finishReason: "stop" });

async function turn(store: ConversationStore, convId: string, message: string, responses: ChatResponse[]) {
  const { client, requests } = fakeClient(responses);
  const events: TurnEvent[] = [];
  for await (const e of runTurn({ conversationId: convId, message, store, clientFactory: () => client })) {
    events.push(e);
  }
  return { events, requests };
}

describe("multi-turn mechanics (Prompt 3 §3 scenarios, server-side plumbing)", () => {
  it("search stores indexed items so the LLM can resolve 'doosri wali'/'shaam wali', and derives result cards", async () => {
    const store = new ConversationStore();
    const { events } = await turn(store, "mt-1", "Ludhiana se Delhi ki trains batao", [
      tools([{ id: "c1", name: "SEARCH_TRAINS", args: { from: "LDH", to: "NDLS", date: "2026-10-12" } }]),
      text("Ye rahi trains."),
    ]);

    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ tool: "SEARCH_TRAINS", status: "ok" });
    const message = events.find((e) => e.type === "message") as Extract<TurnEvent, { type: "message" }>;
    expect(message.cards).toHaveLength(3);
    expect(message.cards[2].trainName).toBe("Evening Superfast");

    // The context block the LLM will see next turn carries indexed items —
    // this is what makes reference resolution POSSIBLE without any server-
    // side interpretation of "doosri"/"shaam".
    const block = store.buildContextBlock(store.get("mt-1")!, "tNext", "2026-10-10");
    expect(block).toContain("1) 12951 Morning Express");
    expect(block).toContain("2) 12013 Afternoon Shatabdi");
    expect(block).toContain("3) 12455 Evening Superfast");
  });

  it("a follow-up fare call for a referenced train flows through with journey context updated", async () => {
    const store = new ConversationStore();
    await turn(store, "mt-2", "Ludhiana se Delhi ki trains batao", [
      tools([{ id: "c1", name: "SEARCH_TRAINS", args: { from: "LDH", to: "NDLS", date: "2026-10-12" } }]),
      text("Trains mil gayi."),
    ]);

    // The (fake) LLM resolves "doosri wali" against the item list IT saw and
    // calls GET_FARE for train 12013 in 3A ("usi train mein 3AC" style).
    const { events, requests } = await turn(store, "mt-2", "Doosri wali ka 3AC fare batao", [
      tools([{ id: "c2", name: "GET_FARE", args: { trainNumber: "12013", from: "LDH", to: "NDLS", classCode: "3A" } }]),
      text("12013 ka 3AC fare ₹1180.50 hai."),
    ]);

    expect(events.find((e) => e.type === "tool_call")).toMatchObject({ tool: "GET_FARE" });
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ tool: "GET_FARE", status: "ok", classCode: "3A" });
    // The model saw the resolvable item list in its context (server supplies data, model decides).
    const ctxBlock = requests[0]?.messages[1]?.content ?? "";
    expect(ctxBlock).toContain("2) 12013");
    expect(store.get("mt-2")!.journey).toMatchObject({ trainNumber: "12013", classCode: "3A" });
  });

  it("date correction mid-conversation supersedes the earlier search end-to-end", async () => {
    const store = new ConversationStore();
    await turn(store, "mt-3", "Ludhiana se Delhi trains, kal", [
      tools([{ id: "c1", name: "SEARCH_TRAINS", args: { from: "LDH", to: "NDLS", date: "2026-10-11" } }]),
      text("Kal ki trains."),
    ]);
    await turn(store, "mt-3", "Kal nahi, parso", [
      tools([{ id: "c2", name: "SEARCH_TRAINS", args: { from: "LDH", to: "NDLS", date: "2026-10-12" } }]),
      text("Parso ki trains."),
    ]);

    const conv = store.get("mt-3")!;
    expect(conv.results[0].supersededBy).toBeDefined();
    expect(conv.journey.date).toBe("2026-10-12");
    const block = store.buildContextBlock(conv, "tX", "2026-10-10");
    expect(block).toContain("SUPERSEDED");
  });

  it("a tool failure surfaces honestly to the model, which can then answer without fabricating", async () => {
    fareShouldFail = true;
    const store = new ConversationStore();
    const { events, requests } = await turn(store, "mt-4", "12013 ka fare?", [
      tools([{ id: "c1", name: "GET_FARE", args: { trainNumber: "12013", from: "LDH", to: "NDLS", classCode: "3A" } }]),
      text("Fare abhi fetch nahi ho pa raha — thodi der baad try karein."),
    ]);

    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ tool: "GET_FARE", status: "error" });
    const toolMsg = requests[1]?.messages.find((m) => m.role === "tool") as { content: string };
    const payload = JSON.parse(toolMsg.content);
    expect(payload.status).toBe("error");
    expect(payload.note).toContain("do not guess");
    // The turn still completes with the model's honest answer — no mock data.
    expect(events.find((e) => e.type === "message")?.type).toBe("message");
  });
});
