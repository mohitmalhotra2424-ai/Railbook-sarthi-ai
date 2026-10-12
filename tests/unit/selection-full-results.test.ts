import { afterEach, beforeEach, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import type { ChatResponse, OpenAiCompatibleClient } from "@/assistant/llm/client";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import { TOOL_ARG_SCHEMAS, TOOL_DEFINITIONS } from "@/assistant/tools/schemas";
import { executeTool } from "@/assistant/tools/executor";
import type { ResultEnvelope, SourceInfo, TrainSearchProvider } from "@/providers/types";

/**
 * PROMPT 35/36 — complete train-selection hardening.
 * UI cards render the FULL provider list, so SELECT_TRAIN must resolve
 * number / name / position identities against that same complete
 * authoritative set (any position), while the LLM's rendered conversational
 * context stays capped at 8 summaries. Deterministic doubles only: scripted
 * LLM (test double) + fixture provider with 120 rows.
 */

const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: `docs/provider-terms.md#${id}`,
  authorization: "configured",
});

const ROW_COUNT = 120; // realistic fixture >100 rows; final position = 120
const rowAt = (i: number) => {
  const base = {
    trainNumber: String(90001 + i),
    trainName: `Full List Express ${i + 1}`,
    from: { code: "LDH", name: "Ludhiana" },
    to: { code: "NDLS", name: "Delhi" },
    departure: "06:15",
    arrival: "10:30",
    classes: ["CC", "EC"],
  };
  if (i === 24) base.trainName = "Swarn Shatabdi Exp"; // position 25 — unique name
  if (i === 49) base.trainName = "Himalayan Queen"; // position 50 — unique name
  if (i === 29 || i === 59) base.trainName = "Twin Express"; // duplicate name ×2
  return base;
};

function fixtureAdapter(): TrainSearchProvider {
  return {
    id: "sfr-search",
    capabilities: ["trainSearch"],
    termsRef: "docs/provider-terms.md#sfr-search",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async search(q, ctx): Promise<ResultEnvelope<never>> {
      const qq = q as { date?: string; to?: string; refresh?: boolean };
      const rows =
        qq.date === "2026-10-13"
          ? [{ ...rowAt(0), trainNumber: "91001", trainName: "Next Day Express" }]
          : qq.to === "ASR"
            ? [{ ...rowAt(0), trainNumber: "92001", trainName: "Amritsar Mail", to: { code: "ASR", name: "Amritsar" } }]
            : qq.refresh // same route/date refresh → NEWER 3-row result version
              ? [
                  { ...rowAt(0), trainNumber: "93001", trainName: "Refreshed One" },
                  { ...rowAt(1), trainNumber: "93002", trainName: "Refreshed Two" },
                  { ...rowAt(2), trainNumber: "93003", trainName: "Refreshed Three" },
                ]
              : Array.from({ length: ROW_COUNT }, (_, i) => rowAt(i));
      return okEnvelope({
        data: rows,
        source: src("sfr-search"),
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

const LLM_ENV = ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL", "RAILWAY_PROVIDER_IDS", "RAILWAY_PROVIDER_SFR_SEARCH_KEY"];
beforeEach(() => {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  process.env.RAILWAY_PROVIDER_IDS = "sfr-search";
  process.env.RAILWAY_PROVIDER_SFR_SEARCH_KEY = "cred";
  registerAdapter(fixtureAdapter());
});
afterEach(() => {
  unregisterAdapter("sfr-search");
  for (const k of LLM_ENV) delete process.env[k];
});

async function drain(run: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of run) out.push(e);
  return out;
}

async function searchTurn(store: ConversationStore, cid: string, date = "2026-10-12", to = "NDLS", refresh?: boolean) {
  return drain(
    runTurn({
      conversationId: cid,
      message: "trains dikhao",
      store,
      clientFactory: oneClient([
        tools("s1", "SEARCH_TRAINS", { from: "LDH", to, date, ...(refresh ? { refresh: true } : {}) }),
        text("Ye trains hain."),
      ]),
    }),
  );
}

async function selectTurn(store: ConversationStore, cid: string, args: Record<string, unknown> | string) {
  const a = typeof args === "string" ? { trainNumber: args } : args;
  return drain(
    runTurn({
      conversationId: cid,
      message: "select karo",
      store,
      clientFactory: oneClient([tools("t1", "SELECT_TRAIN", a), text("ok")]),
    }),
  );
}

/** Direct executor call — exposes the tool NOTE (UI events carry only a short summary). */
const execSelect = (store: ConversationStore, cid: string, args: Record<string, unknown>) =>
  executeTool("SELECT_TRAIN", args, undefined, { conversationId: cid, turnId: "t-exec", toolCallId: "c-exec", store });

const toolResultOf = (ev: TurnEvent[]) =>
  ev.find((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>;

/* ================= identity: train number ================= */

it("a train among the first 8 results can be selected (positions 3 and 8)", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-1");
  expect(toolResultOf(await selectTurn(store, "fr-1", "90003")).status).toBe("ok");
  expect(store.get("fr-1")?.selection?.trainNumber).toBe("90003");
  expect(toolResultOf(await selectTurn(store, "fr-1", "90008")).status).toBe("ok");
  expect(store.get("fr-1")?.selection?.trainNumber).toBe("90008");
});

it("exact train numbers at positions 9, 25, 40, 100 and the final result are selectable", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-2");
  for (const pos of [9, 25, 40, 100, ROW_COUNT]) {
    const num = String(90000 + pos);
    expect(toolResultOf(await selectTurn(store, "fr-2", num)).status).toBe("ok");
    expect(store.get("fr-2")?.selection?.trainNumber).toBe(num);
  }
  const ev = await selectTurn(store, "fr-2", "90025");
  const form = ev.find((e) => e.type === "passenger_form") as Extract<TurnEvent, { type: "passenger_form" }>;
  expect(form.selection?.trainNumber).toBe("90025"); // the live 12030-at-#25 case
  expect(form.selection?.classes).toContain("CC");
});

it("train number with leading/trailing whitespace (and as a JSON number) still resolves exactly", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-3");
  expect(toolResultOf(await selectTurn(store, "fr-3", { trainNumber: " 90025 " })).status).toBe("ok");
  expect(store.get("fr-3")?.selection?.trainNumber).toBe("90025");
  expect(toolResultOf(await selectTurn(store, "fr-3", { trainNumber: 90040 })).status).toBe("ok");
  expect(store.get("fr-3")?.selection?.trainNumber).toBe("90040");
});

it("a four-digit input never matches a five/six-digit train number (no prefix selection)", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-4");
  // "9000" is a prefix of 90001…90009 — it must NOT select any of them.
  expect(toolResultOf(await selectTurn(store, "fr-4", "9000")).status).toBe("error");
  expect(store.get("fr-4")?.selection).toBeUndefined();
});

/* ================= identity: train name ================= */

it("exact normalized name resolves — case, repeated whitespace and punctuation differences are harmless", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-5");
  expect(toolResultOf(await selectTurn(store, "fr-5", { trainName: "  swarn   shatabdi exp. " })).status).toBe("ok");
  expect(store.get("fr-5")?.selection?.trainNumber).toBe("90025");
  expect(store.get("fr-5")?.selection?.trainName).toBe("Swarn Shatabdi Exp");
});

it("a unique name resolves; an exact match wins over loose substring candidates", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-6");
  // "Full List Express 5" is also a substring of "...51"…"...59" — the exact
  // match must win, not an arbitrary substring candidate.
  expect(toolResultOf(await selectTurn(store, "fr-6", { trainName: "Full List Express 5" })).status).toBe("ok");
  expect(store.get("fr-6")?.selection?.trainNumber).toBe("90005");
});

it("duplicate names produce clarification — never an arbitrary selection", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-7");
  const res = await execSelect(store, "fr-7", { trainName: "Twin Express" }); // rows 30 AND 60
  expect(res.status).toBe("error");
  expect(res.note).toContain("matches 2 trains");
  expect(res.note).toContain("train NUMBER");
  expect(store.get("fr-7")?.selection).toBeUndefined();
});

it("number and name identifying the SAME train succeed", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-8");
  expect(toolResultOf(await selectTurn(store, "fr-8", { trainNumber: "90050", trainName: "himalayan queen" })).status).toBe("ok");
  expect(store.get("fr-8")?.selection?.trainNumber).toBe("90050");
});

it("conflicting number and name are rejected — neither is selected", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-9");
  const res = await execSelect(store, "fr-9", { trainNumber: "90025", trainName: "Himalayan Queen" });
  expect(res.status).toBe("error");
  expect(res.note).toContain("conflict");
  expect(store.get("fr-9")?.selection).toBeUndefined();
});

it("absent train number or name is rejected; nothing selected", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-10");
  expect(toolResultOf(await selectTurn(store, "fr-10", "99999")).status).toBe("error");
  const res = await execSelect(store, "fr-10", { trainName: "Nonexistent Mail" });
  expect(res.status).toBe("error");
  expect(res.note).toContain("NOT in the current valid search results");
  expect(store.get("fr-10")?.selection).toBeUndefined();
});

it("name-as-trainNumber is rejected by the schema — no silent wrong selection", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-11");
  const ev = await selectTurn(store, "fr-11", { trainNumber: "Swarn Shatabdi Exp" });
  expect(toolResultOf(ev).status).toBe("invalid_arguments");
  expect(store.get("fr-11")?.selection).toBeUndefined();
});

/* ================= identity: result position (UI 1-based convention) ================= */

it("resultPosition uses the UI's 1-based convention against the COMPLETE list (1, 9, 25, final)", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-12");
  for (const pos of [1, 9, 25, ROW_COUNT]) {
    expect(toolResultOf(await selectTurn(store, "fr-12", { resultPosition: pos })).status).toBe("ok");
    expect(store.get("fr-12")?.selection?.trainNumber).toBe(String(90000 + pos));
  }
});

it("invalid and out-of-range positions are rejected", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-13");
  expect(toolResultOf(await selectTurn(store, "fr-13", { resultPosition: 0 })).status).toBe("invalid_arguments");
  expect(toolResultOf(await selectTurn(store, "fr-13", { resultPosition: 1.5 })).status).toBe("invalid_arguments");
  expect(toolResultOf(await selectTurn(store, "fr-13", { resultPosition: ROW_COUNT + 1 })).status).toBe("error");
  expect(store.get("fr-13")?.selection).toBeUndefined();
});

/* ================= freshness / state safety ================= */

it("a train present only in a superseded search (date change) is rejected", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-14", "2026-10-12");
  await searchTurn(store, "fr-14", "2026-10-13");
  expect(store.get("fr-14")!.results[0].supersededBy).toBeDefined();
  expect(toolResultOf(await selectTurn(store, "fr-14", "90025")).status).toBe("error");
  expect(toolResultOf(await selectTurn(store, "fr-14", { resultPosition: 25 })).status).toBe("error");
  expect(store.get("fr-14")?.selection).toBeUndefined();
});

it("a train present only under a superseded route is rejected; the new route's train works", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-15", "2026-10-12", "NDLS");
  await searchTurn(store, "fr-15", "2026-10-12", "ASR");
  expect(store.get("fr-15")!.results[0].supersededBy).toBeDefined();
  expect(toolResultOf(await selectTurn(store, "fr-15", "90025")).status).toBe("error");
  expect(toolResultOf(await selectTurn(store, "fr-15", "92001")).status).toBe("ok");
  expect(store.get("fr-15")?.selection?.trainNumber).toBe("92001");
});

it("a same-route/date refresh supersedes the old result version; pending selection is cleared; stale trains/positions rejected", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-16");
  expect(toolResultOf(await selectTurn(store, "fr-16", "90025")).status).toBe("ok"); // pending selection
  await searchTurn(store, "fr-16", "2026-10-12", "NDLS", true); // refresh → newer 3-row version
  const conv = store.get("fr-16")!;
  expect(conv.results[0].supersededBy).toBeDefined();
  expect(conv.results[0].supersededReason).toContain("newer search");
  expect(conv.selection).toBeUndefined(); // old selection NOT applied to the new session
  expect(toolResultOf(await selectTurn(store, "fr-16", "90025")).status).toBe("error"); // stale train
  expect(toolResultOf(await selectTurn(store, "fr-16", { resultPosition: 25 })).status).toBe("error"); // stale position
  expect(toolResultOf(await selectTurn(store, "fr-16", "93002")).status).toBe("ok"); // new version selectable
});

it("SELECT_TRAIN without any search in the session is rejected (session mismatch)", async () => {
  const store = new ConversationStore();
  expect(toolResultOf(await selectTurn(store, "fr-17", "90025")).status).toBe("error");
  expect(store.get("fr-17")?.selection).toBeUndefined();
});

/* ================= context cap, non-mutation, efficiency ================= */

it("the LLM's rendered conversational context stays capped at 8 summaries with an accurate '+N more' count", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-18");
  const block = store.buildContextBlock(store.get("fr-18")!, "tNext", "2026-10-10");
  expect(block).toContain("8) 90008 "); // 8th summary rendered
  expect(block).not.toContain("90009 "); // 9th NOT rendered
  expect(block).toContain(`(+${ROW_COUNT - 8} more in current results`); // accurate count
  expect(store.get("fr-18")!.results[0].items).toHaveLength(ROW_COUNT); // full list intact
});

it("building the compact LLM context never mutates or truncates the authoritative list", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-19");
  const conv = store.get("fr-19")!;
  store.buildContextBlock(conv, "tNext", "2026-10-10");
  store.buildContextBlock(conv, "tNext2", "2026-10-10");
  expect(store.get("fr-19")!.results[0].items).toHaveLength(ROW_COUNT);
  expect(toolResultOf(await selectTurn(store, "fr-19", "90120")).status).toBe("ok"); // still selectable after compaction
});

it("selection makes exactly the normal tool+text LLM calls — no second resolution call is introduced", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-20");
  let calls = 0;
  const script = [tools("t1", "SELECT_TRAIN", { trainName: "Swarn Shatabdi Exp" }), text("Select ho gayi.")];
  const counting = {
    config: { provider: "fake", model: "fake", apiKey: "x", baseUrl: "y", timeoutMs: 5000 },
    async chat(): Promise<ChatResponse> {
      calls += 1;
      return script[Math.min(calls, script.length) - 1];
    },
  } as unknown as OpenAiCompatibleClient;
  await drain(
    runTurn({
      conversationId: "fr-20",
      message: "Swarn Shatabdi select karni hai",
      store,
      clientFactory: () => counting,
    }),
  );
  expect(calls).toBe(2); // tool call + final text — nothing extra
  expect(store.get("fr-20")?.selection?.trainNumber).toBe("90025");
});

/* ================= UI card parity + contract compatibility ================= */

it("UI cards and every selection flow resolve against the same current result set (card at position 25)", async () => {
  const store = new ConversationStore();
  const ev = await searchTurn(store, "fr-21");
  const message = ev.find((e) => e.type === "message") as Extract<TurnEvent, { type: "message" }>;
  expect(message.cards).toHaveLength(ROW_COUNT); // cards render the FULL provider list
  const tapped = message.cards![24].trainNumber!; // a card tap sends the card's own number
  expect(tapped).toBe("90025");
  expect(toolResultOf(await selectTurn(store, "fr-21", tapped)).status).toBe("ok"); // number flow
  expect(store.get("fr-21")?.selection?.trainNumber).toBe("90025");
  expect(toolResultOf(await selectTurn(store, "fr-21", { trainName: "Swarn Shatabdi Exp" })).status).toBe("ok"); // name flow
  expect(toolResultOf(await selectTurn(store, "fr-21", { resultPosition: 25 })).status).toBe("ok"); // position flow
  expect(store.get("fr-21")?.selection?.trainNumber).toBe("90025"); // all three agree
});

it("SELECT_TRAIN schema and model-facing definition expose the extended optional identity fields", () => {
  const def = TOOL_DEFINITIONS.find((d) => (d as { function?: { name?: string } }).function?.name === "SELECT_TRAIN")! as unknown as {
    function: { parameters: { properties: Record<string, unknown>; required: string[] } };
  };
  expect(Object.keys(def.function.parameters.properties)).toEqual(
    expect.arrayContaining(["trainNumber", "trainName", "resultPosition"]),
  );
  expect(def.function.parameters.required).toEqual([]); // backward compatible: number-only calls still valid
  expect(TOOL_ARG_SCHEMAS.SELECT_TRAIN.safeParse({ trainNumber: " 90025 " }).success).toBe(true);
  expect(TOOL_ARG_SCHEMAS.SELECT_TRAIN.safeParse({ trainNumber: 90025 }).success).toBe(true);
  expect(TOOL_ARG_SCHEMAS.SELECT_TRAIN.safeParse({ trainName: "Swarn Shatabdi" }).success).toBe(true);
  expect(TOOL_ARG_SCHEMAS.SELECT_TRAIN.safeParse({ resultPosition: 25 }).success).toBe(true);
  expect(TOOL_ARG_SCHEMAS.SELECT_TRAIN.safeParse({}).success).toBe(false); // at least one identity required
  expect(TOOL_ARG_SCHEMAS.SELECT_TRAIN.safeParse({ resultPosition: 0 }).success).toBe(false);
  expect(TOOL_ARG_SCHEMAS.SELECT_TRAIN.safeParse({ trainNumber: "12" }).success).toBe(false);
});
