import { afterEach, beforeEach, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import type { ChatResponse, OpenAiCompatibleClient } from "@/assistant/llm/client";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type { ResultEnvelope, SourceInfo, TrainSearchProvider } from "@/providers/types";

/**
 * PROMPT 30 — end-to-end journey reliability (new coverage: position-based
 * selection and stale-result protection). Deterministic: scripted LLM +
 * fixture providers. Broader A–O coverage maps to existing suites (see the
 * P30 report); nothing here duplicates them blindly.
 */

const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: "t",
  authorization: "configured",
});

const makeAdapter = (id: string, trains: { n: string; name: string; cls: string[] }[]): TrainSearchProvider => ({
  id,
  capabilities: ["trainSearch"],
  termsRef: "t",
  async health() {
    return { ok: true, latencyMs: 1, errors: [] };
  },
  async search(q, ctx): Promise<ResultEnvelope<never>> {
    return okEnvelope({
      data: trains.map((t, i) => ({
        trainNumber: t.n,
        trainName: t.name,
        from: { code: "LDH", name: "Ludhiana" },
        to: { code: (q as { to?: string }).to ?? "NDLS", name: "Dest" },
        departure: `0${6 + i}:15`,
        arrival: "10:30",
        classes: t.cls,
      })),
      source: src(id),
      ttlSeconds: 300,
      requestId: ctx.requestId,
    }) as ResultEnvelope<never>;
  },
});

function scriptedClient(script: ChatResponse[]): OpenAiCompatibleClient {
  let n = 0;
  return {
    config: { provider: "fake", model: "fake", apiKey: "x", baseUrl: "y", timeoutMs: 5000 },
    async chat(): Promise<ChatResponse> {
      const r = script[Math.min(n, script.length - 1)];
      n += 1;
      return r;
    },
  } as unknown as OpenAiCompatibleClient;
}
const oneClient = (s: ChatResponse[]) => {
  const c = scriptedClient(s);
  return () => c;
};
const tools = (id: string, name: string, args: Record<string, unknown>): ChatResponse => ({
  content: null,
  toolCalls: [{ id, name, args }],
  model: "fake",
  finishReason: "tool_calls",
});
const text = (t: string): ChatResponse => ({ content: t, toolCalls: [], model: "fake", finishReason: "stop" });

const LLM_ENV = ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL", "RAILWAY_PROVIDER_IDS", "RAILWAY_PROVIDER_J30_A_KEY", "RAILWAY_PROVIDER_J30_B_KEY"];
beforeEach(() => {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  process.env.RAILWAY_PROVIDER_IDS = "j30-a";
  process.env.RAILWAY_PROVIDER_J30_A_KEY = "cred";
  process.env.RAILWAY_PROVIDER_J30_B_KEY = "cred";
  registerAdapter(makeAdapter("j30-a", [
    { n: "12951", name: "Morning Express", cls: ["SL", "3A", "2A"] },
    { n: "12013", name: "Afternoon Shatabdi", cls: ["CC"] },
  ]));
  registerAdapter(makeAdapter("j30-b", [{ n: "11111", name: "Night Mail", cls: ["SL"] }]));
});
afterEach(() => {
  unregisterAdapter("j30-a");
  unregisterAdapter("j30-b");
  for (const k of LLM_ENV) delete process.env[k];
});

async function drain(run: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of run) out.push(e);
  return out;
}
const toolStatuses = (ev: TurnEvent[]): string[] =>
  (ev.filter((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>[]).map((t) => `${t.tool}:${t.status}`);

it("A/B: position-based and name-based selection resolve against the CURRENT displayed results", async () => {
  const store = new ConversationStore();
  await drain(
    runTurn({
      conversationId: "j30-ab",
      message: "LDH se Delhi trains",
      store,
      clientFactory: oneClient([
        tools("s", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-12" }),
        text("Do trains hain: 12951 Morning Express aur 12013 Afternoon Shatabdi."),
      ]),
    }),
  );
  // User says "pehli wali" — the model (not a keyword router) maps it to the
  // first CURRENT item; backend validates against the same current results.
  const ev = await drain(
    runTurn({
      conversationId: "j30-ab",
      message: "Pehli wali select karo",
      store,
      clientFactory: oneClient([tools("t", "SELECT_TRAIN", { trainNumber: "12951" }), text("Select ho gayi.")]),
    }),
  );
  expect(toolStatuses(ev)).toEqual(["SELECT_TRAIN:ok"]);
  expect(store.get("j30-ab")?.selection?.trainNumber).toBe("12951");
});

it("C/K: after a journey change, an outdated train selection is rejected — stale results cannot be reused", async () => {
  const store = new ConversationStore();
  await drain(
    runTurn({
      conversationId: "j30-ck",
      message: "trains",
      store,
      clientFactory: oneClient([
        tools("s", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-12" }),
        text("list"),
      ]),
    }),
  );
  await drain(
    runTurn({
      conversationId: "j30-ck",
      message: "12951 select",
      store,
      clientFactory: oneClient([
        tools("t", "SELECT_TRAIN", { trainNumber: "12951" }),
        tools("c", "SELECT_CLASS", { classCode: "3A" }),
        tools("p", "UPDATE_PASSENGER", { field: "name", value: "Rahul Sharma" }),
        text("ok"),
      ]),
    }),
  );
  expect(store.get("j30-ck")?.selection?.trainNumber).toBe("12951");

  // Journey changes: fresh provider (different result set) supersedes the search.
  process.env.RAILWAY_PROVIDER_IDS = "j30-b";
  await drain(
    runTurn({
      conversationId: "j30-ck",
      message: "20 Oct ko karo",
      store,
      clientFactory: oneClient([
        tools("s2", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-20" }),
        text("nayi list: 11111 Night Mail"),
      ]),
    }),
  );
  // Supersede cleared the incompatible selection + passengers.
  expect(store.get("j30-ck")?.selection).toBeUndefined();
  expect(store.get("j30-ck")?.passengers).toHaveLength(0);

  // The previously valid train is NOT in the current results → rejected honestly.
  const stale = await drain(
    runTurn({
      conversationId: "j30-ck",
      message: "12951 hi select karo",
      store,
      clientFactory: oneClient([tools("t2", "SELECT_TRAIN", { trainNumber: "12951" }), text("Hmm?")]),
    }),
  );
  expect(toolStatuses(stale)).toEqual(["SELECT_TRAIN:error"]);
  expect(store.get("j30-ck")?.selection).toBeUndefined();

  // A train from the CURRENT set selects fine (proves rejection was staleness-specific).
  const fresh = await drain(
    runTurn({
      conversationId: "j30-ck",
      message: "11111 karo",
      store,
      clientFactory: oneClient([tools("t3", "SELECT_TRAIN", { trainNumber: "11111" }), text("Select ho gayi.")]),
    }),
  );
  expect(toolStatuses(fresh)).toEqual(["SELECT_TRAIN:ok"]);
  expect(store.get("j30-ck")?.selection?.trainNumber).toBe("11111");
});

it("L: provider failure yields no cards and no availability claim — honest error only", async () => {
  const store = new ConversationStore();
  process.env.RAILWAY_PROVIDER_IDS = "missing-provider"; // nothing registered → not_configured
  const ev = await drain(
    runTurn({
      conversationId: "j30-l",
      message: "trains dikhao",
      store,
      clientFactory: oneClient([
        tools("s", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-12" }),
        text("Provider se data nahi aa paya — main kuch guess nahi karunga."),
      ]),
    }),
  );
  const tr = ev.find((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>;
  expect(tr.status).toBe("not_configured");
  const msg = ev.find((e) => e.type === "message") as Extract<TurnEvent, { type: "message" }>;
  expect(msg.cards).toHaveLength(0); // no fabricated trains/availability
});
