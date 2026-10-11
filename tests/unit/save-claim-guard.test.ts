import { afterEach, beforeEach, expect, it } from "vitest";
import { guardSaveClaims } from "@/assistant/passengers/save-claim-guard";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import type { ChatResponse, OpenAiCompatibleClient } from "@/assistant/llm/client";
import type { ToolResult } from "@/assistant/tools/results";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type { ResultEnvelope, SourceInfo, TrainSearchProvider } from "@/providers/types";
import { TOOL_DEFINITIONS } from "@/assistant/tools/schemas";

/**
 * PROMPT 26 — verified save-claim guard (Tests A–J). Deterministic:
 * guard-level unit tests + scripted-LLM orchestrator integration.
 * Clearly test doubles; no live calls.
 */

// ---------- guard-level helpers ----------

const okPaxResult = (passengers: unknown): ToolResult => ({
  tool: "UPDATE_PASSENGER",
  correlationId: "c:1",
  status: "ok",
  note: "saved",
  data: { passengers },
});
const failedPaxResult = (): ToolResult => ({
  tool: "UPDATE_PASSENGER",
  correlationId: "c:2",
  status: "invalid_arguments",
  note: "Age must be a whole number between 1 and 120. Existing form values were NOT changed.",
});

const SAVE_CLAIM = "Age 28 save ho gaya.";
const SAVE_CLAIM_HI = "उम्र 28 सेव हो गई है।";

// ---------- orchestrator harness (scripted LLM + fixture provider) ----------

const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: `docs/provider-terms.md#${id}`,
  authorization: "configured",
});

function fixtureAdapter(): TrainSearchProvider {
  return {
    id: "scg-search",
    capabilities: ["trainSearch"],
    termsRef: "docs/provider-terms.md#scg-search",
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
        ],
        source: src("scg-search"),
        ttlSeconds: 300,
        requestId: ctx.requestId,
      }) as ResultEnvelope<never>;
    },
  };
}

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

const LLM_ENV = ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL", "RAILWAY_PROVIDER_IDS", "RAILWAY_PROVIDER_SCG_SEARCH_KEY"];
beforeEach(() => {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  process.env.RAILWAY_PROVIDER_IDS = "scg-search";
  process.env.RAILWAY_PROVIDER_SCG_SEARCH_KEY = "cred";
  registerAdapter(fixtureAdapter());
});
afterEach(() => {
  unregisterAdapter("scg-search");
  for (const k of LLM_ENV) delete process.env[k];
});

async function drain(run: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of run) out.push(e);
  return out;
}

/** Conversation with a real search + train/class selection (form open). */
async function prepared(store: ConversationStore, cid: string) {
  await drain(
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
  await drain(
    runTurn({
      conversationId: cid,
      message: "select",
      store,
      clientFactory: oneClient([
        tools("a", "SELECT_TRAIN", { trainNumber: "12951" }),
        tools("b", "SELECT_CLASS", { classCode: "3A" }),
        text("form khul gaya"),
      ]),
    }),
  );
}

const messageText = (ev: TurnEvent[]): string =>
  (ev.find((e) => e.type === "message") as Extract<TurnEvent, { type: "message" }> | undefined)?.text ?? "";

// =================== TEST A — exact residual failure ===================

it("A: LLM claims 'Age 28 save ho gaya' with toolResults:0 → claim blocked, form unchanged", async () => {
  const store = new ConversationStore();
  await prepared(store, "g-a");
  // Name legitimately saved first (so the conversation is mid-form).
  await drain(
    runTurn({
      conversationId: "g-a",
      message: "Rahul Sharma",
      store,
      clientFactory: oneClient([tools("n", "UPDATE_PASSENGER", { field: "name", value: "Rahul Sharma" }), text("Naam save ho gaya.")]),
    }),
  );
  expect(store.get("g-a")?.passengers[0]?.name).toBe("Rahul Sharma");

  // The residual failure: model asserts the age was saved WITHOUT calling the tool.
  const ev = await drain(
    runTurn({
      conversationId: "g-a",
      message: "Age 28.",
      store,
      clientFactory: oneClient([text("Age 28 save ho gaya.\n\nAb gender batao — Male / Female / Other.")]),
    }),
  );
  const delivered = messageText(ev);
  expect(ev.filter((e) => e.type === "tool_result")).toHaveLength(0); // toolResults: 0
  expect(delivered).not.toMatch(/save ho gaya/i);
  expect(delivered).toMatch(/Age abhi save confirm nahi hui/);
  // The rest of the honest conversation survives.
  expect(delivered).toMatch(/Ab gender batao/);
  // Authoritative form unchanged: name retained, age never fabricated.
  expect(store.get("g-a")?.passengers[0]).toEqual({ name: "Rahul Sharma" });
  // The corrected text is what gets persisted (history can't carry the lie).
  expect(store.get("g-a")?.messages.at(-1)?.content).toBe(delivered);
});

// =================== TEST B — genuine successful save ===================

it("B: verified successful update → truthful confirmation is permitted", async () => {
  const store = new ConversationStore();
  await prepared(store, "g-b");
  const ev = await drain(
    runTurn({
      conversationId: "g-b",
      message: "Age 28.",
      store,
      clientFactory: oneClient([tools("u", "UPDATE_PASSENGER", { field: "age", value: "28" }), text("Age 28 save ho gaya.")]),
    }),
  );
  const delivered = messageText(ev);
  expect(delivered).toBe("Age 28 save ho gaya."); // untouched
  expect(store.get("g-b")?.passengers[0]?.age).toBe(28);
});

// =================== TEST C — tool failure ===================

it("C: update tool failed but LLM claims saved → confirmation blocked", () => {
  const r = guardSaveClaims({
    text: SAVE_CLAIM,
    turnResults: [failedPaxResult()],
    passengers: [{ name: "Rahul Sharma" }],
  });
  expect(r.adjusted).toBe(true);
  expect(r.text).not.toMatch(/save ho gaya/i);
  expect(r.text).toMatch(/Age abhi save confirm nahi hui/);
  expect(r.blockedClaims[0].field).toBe("age");
});

// =================== TEST D — missing result ===================

it("D: no matching tool result and no state value → no save confirmation", () => {
  const r = guardSaveClaims({ text: SAVE_CLAIM, turnResults: [], passengers: [{ name: "Rahul Sharma" }] });
  expect(r.adjusted).toBe(true);
  expect(r.text).not.toMatch(/save ho gaya/i);
  // Hindi variant is handled in the user's language too.
  const hi = guardSaveClaims({ text: SAVE_CLAIM_HI, turnResults: [], passengers: [] });
  expect(hi.adjusted).toBe(true);
  expect(hi.text).toMatch(/अभी save confirm नहीं हुई/);
});

// =================== TEST E — value mismatch ===================

it("E: success refers to a different value/field/passenger → mismatched claim blocked", () => {
  // Authoritative age is 30; claim says 28 was saved.
  const r = guardSaveClaims({
    text: SAVE_CLAIM,
    turnResults: [okPaxResult([{ name: "Rahul Sharma", age: 30 }])],
    passengers: [{ name: "Rahul Sharma", age: 30 }],
  });
  expect(r.adjusted).toBe(true);
  expect(r.text).not.toMatch(/save ho gaya/i);

  // Name mismatch: claim mentions Priya, authoritative name is Rahul.
  const nm = guardSaveClaims({
    text: "Priya ka naam save ho gaya.",
    turnResults: [okPaxResult([{ name: "Rahul Sharma" }])],
    passengers: [{ name: "Rahul Sharma" }],
  });
  expect(nm.adjusted).toBe(true);

  // Different field: berth saved, but the claim is about age.
  const fd = guardSaveClaims({
    text: SAVE_CLAIM,
    turnResults: [okPaxResult([{ name: "Rahul Sharma", berth: "lower" }])],
    passengers: [{ name: "Rahul Sharma", berth: "lower" }],
  });
  expect(fd.adjusted).toBe(true);
});

// =================== TEST F — stale / cross-session evidence ===================

it("F: superseded (stale) state and another session's success cannot authorize a claim", async () => {
  const store = new ConversationStore();
  await prepared(store, "g-f");
  await drain(
    runTurn({
      conversationId: "g-f",
      message: "Age 28.",
      store,
      clientFactory: oneClient([tools("u", "UPDATE_PASSENGER", { field: "age", value: "28" }), text("save ho gaya")]),
    }),
  );
  expect(store.get("g-f")?.passengers[0]?.age).toBe(28);

  // A different session succeeds — that evidence must not leak.
  await prepared(store, "g-f-other");
  await drain(
    runTurn({
      conversationId: "g-f-other",
      message: "Age 28.",
      store,
      clientFactory: oneClient([tools("v", "UPDATE_PASSENGER", { field: "age", value: "28" }), text("saved")]),
    }),
  );

  // In the ORIGINAL session a date change supersedes everything (state cleared).
  await drain(
    runTurn({
      conversationId: "g-f",
      message: "20 Oct ko karo",
      store,
      clientFactory: oneClient([tools("d", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-20" }), text("nayi list")]),
    }),
  );
  expect(store.get("g-f")?.passengers).toHaveLength(0);

  // Now the model re-claims the stale save: blocked — current state is empty
  // and the other session's success is not visible to this turn.
  const ev = await drain(
    runTurn({
      conversationId: "g-f",
      message: "Age 28.",
      store,
      clientFactory: oneClient([text("Age 28 save ho gaya.")]),
    }),
  );
  expect(messageText(ev)).not.toMatch(/save ho gaya/i);
  expect(messageText(ev)).toMatch(/Age abhi save confirm nahi hui/);
});

// =================== TEST G — existing authoritative state ===================

it("G: value already in authoritative state from a verified earlier update → NOT called unsaved", () => {
  const r = guardSaveClaims({
    text: "Aapki age 28 save ho chuki hai.",
    turnResults: [], // nothing THIS turn — earlier turn validated it
    passengers: [{ name: "Rahul Sharma", age: 28 }],
  });
  expect(r.adjusted).toBe(false);
  expect(r.text).toBe("Aapki age 28 save ho chuki hai.");
});

// =================== TEST H — normal conversation ===================

it("H: ordinary answers and passenger questions pass through unchanged", () => {
  const samples = [
    "12951 Morning Express LDH se 06:15 par chalti hai.",
    "Ab passenger ka naam bataiye.",
    "Age kitni hai aapki?",
    "Train select ho gayi. Ab class chuniye.", // selection talk, not a passenger-field claim
    "Berth preference sirf request hoti hai, guarantee nahi.",
  ];
  for (const s of samples) {
    const r = guardSaveClaims({ text: s, turnResults: [], passengers: [{ name: "Rahul Sharma" }] });
    expect(r.adjusted).toBe(false);
    expect(r.text).toBe(s);
  }
});

// =================== TEST I — voice/text parity ===================

it("I: text and voice share the guarded message event — neither announces an unsupported save", async () => {
  const store = new ConversationStore();
  await prepared(store, "g-i");
  const ev = await drain(
    runTurn({
      conversationId: "g-i",
      message: "Age 28.",
      store,
      clientFactory: oneClient([text("Age 28 save ho gaya.")]),
    }),
  );
  // Exactly one message event feeds BOTH the text bubble and conversation-mode
  // TTS (ChatClient speaks the message content). Guarding it covers voice.
  const msgs = ev.filter((e) => e.type === "message");
  expect(msgs).toHaveLength(1);
  expect(messageText(ev)).not.toMatch(/save ho gaya/i);
});

// =================== TEST J — no unintended changes ===================

it("J: tool schemas/selection unchanged; form validation still authoritative", async () => {
  // Same 12 tools as Prompt 25 — nothing added/removed/reordered by P26.
  expect(TOOL_DEFINITIONS.map((d) => d.function.name)).toEqual([
    "SEARCH_TRAINS",
    "GET_TRAIN_INFO",
    "GET_TIMETABLE",
    "TRACK_TRAIN",
    "CHECK_AVAILABILITY",
    "GET_FARE",
    "CHECK_PNR",
    "GET_CANCELLED_TRAINS",
    "GENERAL_RAILWAY_ANSWER",
    "SELECT_TRAIN",
    "SELECT_CLASS",
    "UPDATE_PASSENGER",
  ]);
  // Form validation path still rejects invalid values end-to-end.
  const store = new ConversationStore();
  await prepared(store, "g-j");
  const ev = await drain(
    runTurn({
      conversationId: "g-j",
      message: "Age 280.",
      store,
      clientFactory: oneClient([tools("x", "UPDATE_PASSENGER", { field: "age", value: "280" }), text("Hmm, dobara bataiye.")]),
    }),
  );
  const tr = ev.find((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>;
  expect(tr.status).toBe("invalid_arguments");
  expect(store.get("g-j")?.passengers[0]?.age).toBeUndefined();
  expect(messageText(ev)).toBe("Hmm, dobara bataiye."); // honest non-claim untouched
});
