import { afterEach, beforeEach, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import type { ChatResponse, OpenAiCompatibleClient } from "@/assistant/llm/client";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type { ResultEnvelope, SourceInfo, TrainSearchProvider } from "@/providers/types";

/**
 * PROMPT 25 — conversational selection + passenger form. Deterministic:
 * scripted LLM (clearly a test double) + fixture provider. No live calls.
 */

const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: `docs/provider-terms.md#${id}`,
  authorization: "configured",
});

function fixtureAdapter(): TrainSearchProvider {
  return {
    id: "ps-search",
    capabilities: ["trainSearch"],
    termsRef: "docs/provider-terms.md#ps-search",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async search(q, ctx): Promise<ResultEnvelope<never>> {
      return okEnvelope({
        data: [
          {
            trainNumber: "12951",
            trainName: "Morning Express",
            from: { code: "LDH", name: "Ludhiana" },
            to: { code: (q as { to?: string }).to ?? "NDLS", name: "Dest" },
            departure: "06:15",
            arrival: "10:30",
            classes: ["SL", "3A", "2A"],
          },
          {
            trainNumber: "12013",
            trainName: "Afternoon Shatabdi",
            from: { code: "LDH", name: "Ludhiana" },
            to: { code: (q as { to?: string }).to ?? "NDLS", name: "Dest" },
            departure: "14:00",
            arrival: "17:10",
            classes: ["CC"],
          },
        ],
        source: src("ps-search"),
        ttlSeconds: 300,
        requestId: ctx.requestId,
      }) as ResultEnvelope<never>;
    },
  };
}

/** LLM double replaying a scripted list of responses, in order. */
function scriptedClient(script: ChatResponse[]): OpenAiCompatibleClient {
  let n = 0;
  const stub = {
    config: { provider: "fake", model: "fake", apiKey: "x", baseUrl: "y", timeoutMs: 5000 },
    async chat(): Promise<ChatResponse> {
      const r = script[Math.min(n, script.length - 1)];
      n += 1;
      return r;
    },
  };
  return stub as unknown as OpenAiCompatibleClient;
}

/** The orchestrator may call clientFactory per attempt — ONE instance per turn. */
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

const LLM_ENV = ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL", "RAILWAY_PROVIDER_IDS", "RAILWAY_PROVIDER_PS_SEARCH_KEY"];
beforeEach(() => {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  process.env.RAILWAY_PROVIDER_IDS = "ps-search";
  process.env.RAILWAY_PROVIDER_PS_SEARCH_KEY = "cred";
  registerAdapter(fixtureAdapter());
});
afterEach(() => {
  unregisterAdapter("ps-search");
  for (const k of LLM_ENV) delete process.env[k];
});

async function drain(run: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of run) out.push(e);
  return out;
}

async function searchTurn(store: ConversationStore, cid: string) {
  return drain(
    runTurn({
      conversationId: cid,
      message: "trains dikhao",
      store,
      clientFactory: oneClient([
        tools("s1", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-12" }),
        text("Ye trains hain."),
      ]),
    }),
  );
}

it("SELECT_TRAIN validates against current results and updates session state + UI event", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "sel-1");

  const ev = await drain(
    runTurn({
      conversationId: "sel-1",
      message: "Pehli wali train select karo",
      store,
      clientFactory: oneClient([tools("t1", "SELECT_TRAIN", { trainNumber: "12951" }), text("Select ho gayi.")]),
    }),
  );
  const tr = ev.filter((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>[];
  expect(tr[0].status).toBe("ok");
  const form = ev.find((e) => e.type === "passenger_form") as Extract<TurnEvent, { type: "passenger_form" }>;
  expect(form.selection?.trainNumber).toBe("12951");
  expect(form.selection?.classes).toContain("3A");
  expect(store.get("sel-1")?.selection?.trainNumber).toBe("12951");
});

it("SELECT_TRAIN rejects a train absent from current results; nothing is selected", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "sel-2");
  const ev = await drain(
    runTurn({
      conversationId: "sel-2",
      message: "22222 select karo",
      store,
      clientFactory: oneClient([tools("t1", "SELECT_TRAIN", { trainNumber: "22222" }), text("ok?")]),
    }),
  );
  const tr = ev.find((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>;
  expect(tr.status).toBe("error");
  expect(store.get("sel-2")?.selection).toBeUndefined();
});

it("SELECT_CLASS: unsupported class rejected honestly; supported class opens the form", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "cls-1");
  await drain(
    runTurn({
      conversationId: "cls-1",
      message: "select",
      store,
      clientFactory: oneClient([tools("a", "SELECT_TRAIN", { trainNumber: "12013" }), text("sel")]),
    }),
  );
  const bad = await drain(
    runTurn({
      conversationId: "cls-1",
      message: "3A kar do",
      store,
      clientFactory: oneClient([tools("b", "SELECT_CLASS", { classCode: "3A" }), text("hmm")]),
    }),
  );
  const badTr = bad.find((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>;
  expect(badTr.status).toBe("error");
  expect(store.get("cls-1")?.selection?.classCode).toBeUndefined();

  const good = await drain(
    runTurn({
      conversationId: "cls-1",
      message: "CC sahi hai",
      store,
      clientFactory: oneClient([tools("c", "SELECT_CLASS", { classCode: "CC" }), text("form khul gaya")]),
    }),
  );
  const form = good.find((e) => e.type === "passenger_form") as Extract<TurnEvent, { type: "passenger_form" }>;
  expect(form.selection?.classCode).toBe("CC");
});

it("UPDATE_PASSENGER validates, corrects in place, and isolates passengers", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "pax-1");
  const ev = await drain(
    runTurn({
      conversationId: "pax-1",
      message: "details",
      store,
      clientFactory: oneClient([
        tools("a", "SELECT_TRAIN", { trainNumber: "12951" }),
        tools("b", "SELECT_CLASS", { classCode: "3A" }),
        tools("c", "UPDATE_PASSENGER", { field: "name", value: "Rahul Sharma" }),
        tools("d", "UPDATE_PASSENGER", { field: "age", value: "280" }),
        tools("e", "UPDATE_PASSENGER", { field: "age", value: "28" }),
        tools("f", "UPDATE_PASSENGER", { passenger: 2, field: "name", value: "Priya Sharma" }),
        text("done"),
      ]),
    }),
  );
  const trs = ev.filter((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>[];
  expect(trs.map((t) => `${t.tool}:${t.status}`)).toEqual([
    "SELECT_TRAIN:ok",
    "SELECT_CLASS:ok",
    "UPDATE_PASSENGER:ok",
    "UPDATE_PASSENGER:invalid_arguments",
    "UPDATE_PASSENGER:ok",
    "UPDATE_PASSENGER:error",
  ]);
  // Second turn: the correction overwrites the same field (no duplicate)
  const ev2 = await drain(
    runTurn({
      conversationId: "pax-1",
      message: "naam galat tha",
      store,
      clientFactory: oneClient([tools("g", "UPDATE_PASSENGER", { field: "name", value: "Rohit Sharma" }), text("done")]),
    }),
  );
  const tr2 = ev2.filter((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>[];
  expect(tr2.map((t) => t.status)).toEqual(["ok"]);
  const pax = store.get("pax-1")?.passengers ?? [];
  expect(pax).toHaveLength(1);
  expect(pax[0]).toMatchObject({ name: "Rohit Sharma", age: 28 });
});

it("food preference is unsupported and honestly rejected; berth stays an unverified request", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "pax-2");
  const ev = await drain(
    runTurn({
      conversationId: "pax-2",
      message: "x",
      store,
      clientFactory: oneClient([
        tools("a", "SELECT_TRAIN", { trainNumber: "12951" }),
        tools("b", "SELECT_CLASS", { classCode: "3A" }),
        tools("c", "UPDATE_PASSENGER", { field: "food", value: "veg" }),
        tools("d", "UPDATE_PASSENGER", { field: "berth", value: "lower" }),
        text("done"),
      ]),
    }),
  );
  const trs = ev.filter((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>[];
  expect(trs.map((t) => t.status)).toEqual(["ok", "ok", "invalid_arguments", "ok"]);
  expect(store.get("pax-2")?.passengers[0]?.berth).toBe("lower");
});

it("a changed journey date supersedes the search and clears selection + passenger state", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "sup-1");
  await drain(
    runTurn({
      conversationId: "sup-1",
      message: "select",
      store,
      clientFactory: oneClient([
        tools("a", "SELECT_TRAIN", { trainNumber: "12951" }),
        tools("b", "SELECT_CLASS", { classCode: "3A" }),
        tools("c", "UPDATE_PASSENGER", { field: "name", value: "Rahul Sharma" }),
        text("ok"),
      ]),
    }),
  );
  expect(store.get("sup-1")?.selection?.classCode).toBe("3A");

  await drain(
    runTurn({
      conversationId: "sup-1",
      message: "20 Oct ko karo",
      store,
      clientFactory: oneClient([
        tools("d", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-20" }),
        text("nayi list"),
      ]),
    }),
  );
  expect(store.get("sup-1")?.selection).toBeUndefined();
  expect(store.get("sup-1")?.passengers).toHaveLength(0);
});
