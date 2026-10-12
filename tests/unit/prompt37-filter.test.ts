import { afterEach, beforeEach, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import type { ChatResponse, OpenAiCompatibleClient } from "@/assistant/llm/client";
import type { ToolResult } from "@/assistant/tools/results";
import { executeTool } from "@/assistant/tools/executor";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type { ResultEnvelope, SourceInfo, TrainSearchProvider } from "@/providers/types";

/**
 * PROMPT 37 — natural-language filtering/sorting of the CURRENT authoritative
 * results via FILTER_TRAINS. Deterministic doubles: scripted LLM + 24-row
 * fixture with varied classes/times/durations. Selection compatibility with
 * Prompt 35/36 and non-mutation of authoritative results are asserted here;
 * broader suites run unchanged.
 */

const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: `docs/provider-terms.md#${id}`,
  authorization: "configured",
});

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const CLASSES: string[][] = [
  ["3A", "2A"],
  ["SL"],
  ["SL", "3A", "2A"],
  ["CC", "EC"],
];
const ROW_COUNT = 24;
const rowAt = (i: number) => {
  const depMin = 240 + i * 45; // from 04:00, every 45 min
  const durMin = 210 + (i % 5) * 6 + (i % 7 === 3 ? 600 : 0); // some 13h+ journeys
  return {
    trainNumber: String(91001 + i),
    trainName: `Filter Express ${i + 1}`,
    from: { code: "LDH", name: "Ludhiana" },
    to: { code: "NDLS", name: "Delhi" },
    departure: hhmm(depMin),
    arrival: hhmm(depMin + durMin),
    classes: CLASSES[i % 4],
  };
};
const ROWS = Array.from({ length: ROW_COUNT }, (_, i) => rowAt(i));

function fixtureAdapter(): TrainSearchProvider {
  return {
    id: "p37-search",
    capabilities: ["trainSearch"],
    termsRef: "docs/provider-terms.md#p37-search",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async search(q, ctx): Promise<ResultEnvelope<never>> {
      const date = (q as { date?: string }).date;
      const rows =
        date === "2026-10-13"
          ? [{ trainNumber: "93001", trainName: "Next Day Express", from: { code: "LDH", name: "Ludhiana" }, to: { code: "NDLS", name: "Delhi" }, departure: "07:00", arrival: "11:00", classes: ["SL"] }]
          : ROWS;
      return okEnvelope({ data: rows, source: src("p37-search"), ttlSeconds: 300, requestId: ctx.requestId }) as ResultEnvelope<never>;
    },
  };
}

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
const toolResult = (tool: string, over: Partial<ToolResult> = {}): ToolResult => ({
  tool,
  correlationId: `c:t:${tool}`,
  status: "ok",
  note: "n",
  ...over,
});

const LLM_ENV = ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL", "RAILWAY_PROVIDER_IDS", "RAILWAY_PROVIDER_P37_SEARCH_KEY"];
beforeEach(() => {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  process.env.RAILWAY_PROVIDER_IDS = "p37-search";
  process.env.RAILWAY_PROVIDER_P37_SEARCH_KEY = "cred";
  registerAdapter(fixtureAdapter());
});
afterEach(() => {
  unregisterAdapter("p37-search");
  for (const k of LLM_ENV) delete process.env[k];
});

async function drain(run: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of run) out.push(e);
  return out;
}

async function searchTurn(store: ConversationStore, cid: string, date = "2026-10-12") {
  return drain(
    runTurn({
      conversationId: cid,
      message: "trains dikhao",
      store,
      clientFactory: oneClient([tools("s1", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date }), text("Ye trains hain.")]),
    }),
  );
}

async function filterTurn(store: ConversationStore, cid: string, args: Record<string, unknown>) {
  return drain(
    runTurn({
      conversationId: cid,
      message: "filter karo",
      store,
      clientFactory: oneClient([tools("f1", "FILTER_TRAINS", args), text("ok")]),
    }),
  );
}

const toolResultOf = (ev: TurnEvent[]) =>
  ev.find((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>;
const cardsOf = (ev: TurnEvent[]) => {
  const message = ev.find((e) => e.type === "message") as Extract<TurnEvent, { type: "message" }>;
  return message.cards ?? [];
};
const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/* ---------- class filtering ---------- */

it("classCode keeps only trains that RUN in that class; cards show the filtered view; authoritative list untouched", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "p37-1");
  const ev = await filterTurn(store, "p37-1", { classCode: "3A" });
  expect(toolResultOf(ev).status).toBe("ok");
  const cards = cardsOf(ev);
  const expected = ROWS.filter((r) => r.classes.includes("3A"));
  expect(cards).toHaveLength(expected.length); // 12 of 24
  expect(cards.map((c) => c.trainNumber)).toEqual(expected.map((r) => r.trainNumber));
  for (const c of cards) expect(c.classes).toContain("3A");
  // authoritative search results are NOT mutated by the filtered view
  const conv = store.get("p37-1")!;
  const searchRef = conv.results.find((r) => r.tool === "SEARCH_TRAINS")!;
  expect(searchRef.items).toHaveLength(ROW_COUNT);
});

it("departure and arrival windows are distinct criteria", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "p37-2");
  const depEv = await filterTurn(store, "p37-2", { departsAfter: "18:00" });
  const arrEv = await filterTurn(store, "p37-2", { arrivesBefore: "12:00" });
  const expectedDep = ROWS.filter((r) => toMin(r.departure) >= toMin("18:00"));
  const expectedArr = ROWS.filter((r) => toMin(r.arrival) < toMin("12:00"));
  expect(cardsOf(depEv).map((c) => c.trainNumber)).toEqual(expectedDep.map((r) => r.trainNumber));
  expect(cardsOf(arrEv).map((c) => c.trainNumber)).toEqual(expectedArr.map((r) => r.trainNumber));
  expect(expectedDep.length).toBeGreaterThan(0);
  expect(expectedArr.length).toBeGreaterThan(0);
  // the two criteria genuinely select different sets
  expect(JSON.stringify(expectedDep.map((r) => r.trainNumber))).not.toBe(JSON.stringify(expectedArr.map((r) => r.trainNumber)));
});

/* ---------- duration + sorting ---------- */

it("maxDurationMinutes filters and sortBy duration ranks fastest first (overnight handled)", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "p37-3");
  const ev = await filterTurn(store, "p37-3", { maxDurationMinutes: 240, sortBy: "duration" });
  const expected = ROWS.filter((r) => {
    let d = toMin(r.arrival) - toMin(r.departure);
    if (d <= 0) d += 24 * 60;
    return d <= 240;
  });
  const cards = cardsOf(ev);
  expect(cards).toHaveLength(expected.length);
  expect(expected.length).toBeLessThan(ROW_COUNT); // long journeys excluded
  // durations are non-decreasing across the sorted view
  const durs = cards.map((c) => {
    let d = toMin(c.arrival!) - toMin(c.departure!);
    if (d <= 0) d += 24 * 60;
    return d;
  });
  expect(durs).toEqual([...durs].sort((a, b) => a - b));
  expect(durs[0]).toBeLessThanOrEqual(216);
});

it("sortBy fare ranks only trains with a CHECKED fare; unknowns last, honest count in the note", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "p37-4");
  // seed authoritative GET_FARE refs (3A) — 91005 cheapest, then 91009, 91001
  for (const [num, fare] of [
    ["91001", 900],
    ["91005", 500],
    ["91009", 700],
  ] as [string, number][]) {
    store.beginTurn("p37-4", `t-fare-${num}`, "fare");
    store.recordToolResult(
      "p37-4",
      `t-fare-${num}`,
      "GET_FARE",
      { trainNumber: num, classCode: "3A", from: "LDH", to: "NDLS", date: "2026-10-12" },
      toolResult("GET_FARE", { data: { classCode: "3A", totalFare: fare, currency: "INR" } }),
    );
  }
  const ev = await filterTurn(store, "p37-4", { classCode: "3A", sortBy: "fare" });
  const cards = cardsOf(ev);
  expect(cards.slice(0, 3).map((c) => c.trainNumber)).toEqual(["91005", "91009", "91001"]); // 500 < 700 < 900
  // the tool NOTE (LLM-facing) honestly reports the fare coverage
  const res = await executeTool("FILTER_TRAINS", { classCode: "3A", sortBy: "fare" }, undefined, {
    conversationId: "p37-4",
    turnId: "t-exec",
    toolCallId: "c-exec",
    store,
  });
  expect(res.note).toContain("Fare known for 3/12");
});

it("availableOnly uses only CURRENT recorded live checks — stale or missing data never counts as available", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "p37-5");
  store.beginTurn("p37-5", "t-av1", "availability");
  store.recordToolResult(
    "p37-5",
    "t-av1",
    "CHECK_AVAILABILITY",
    { trainNumber: "91005", classCode: "3A", from: "LDH", to: "NDLS", date: "2026-10-12" },
    toolResult("CHECK_AVAILABILITY", { data: { classes: [{ classCode: "3A", status: "AVAILABLE-5" }] } }),
  );
  store.beginTurn("p37-5", "t-av2", "availability stale");
  store.recordToolResult(
    "p37-5",
    "t-av2",
    "CHECK_AVAILABILITY",
    { trainNumber: "91009", classCode: "3A", from: "LDH", to: "NDLS", date: "2026-10-12" },
    toolResult("CHECK_AVAILABILITY", { freshness: "stale", data: { classes: [{ classCode: "3A", status: "AVAILABLE-2" }] } }),
  );
  const ev = await filterTurn(store, "p37-5", { classCode: "3A", availableOnly: true });
  const cards = cardsOf(ev);
  expect(cards.map((c) => c.trainNumber)).toEqual(["91005"]); // stale 91009 excluded, un-checked excluded
  expect(cards[0].availability?.[0]).toMatchObject({ classCode: "3A", status: "AVAILABLE-5" });
});

/* ---------- combination, no-match, bounded context ---------- */

it("multiple compatible filters combine (class + arrival window + departure sort)", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "p37-6");
  const ev = await filterTurn(store, "p37-6", { classCode: "SL", arrivesBefore: "16:00", sortBy: "departure" });
  const expected = ROWS.filter((r) => r.classes.includes("SL") && toMin(r.arrival) < toMin("16:00")).sort(
    (x, y) => toMin(x.departure) - toMin(y.departure),
  );
  expect(cardsOf(ev).map((c) => c.trainNumber)).toEqual(expected.map((r) => r.trainNumber));
  expect(expected.length).toBeGreaterThan(0);
});

it("no matches: honest report, nothing weakened, nothing invented", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "p37-7");
  const ev = await filterTurn(store, "p37-7", { classCode: "1A" }); // no 1A in results
  expect(toolResultOf(ev).status).toBe("ok");
  expect(cardsOf(ev)).toHaveLength(0);
  const res = await executeTool("FILTER_TRAINS", { classCode: "1A" }, undefined, {
    conversationId: "p37-7",
    turnId: "t-exec",
    toolCallId: "c-exec",
    store,
  });
  expect(res.note).toContain("0 of 24 current results match");
  expect(res.note).toContain("Nothing was weakened");
  expect(store.get("p37-7")?.selection).toBeUndefined();
});

it("the LLM-facing list stays bounded (first 8 + honest '+N more')", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "p37-8");
  const ev = await filterTurn(store, "p37-8", { classCode: "3A" }); // 12 matches
  expect(cardsOf(ev)).toHaveLength(12); // the UI card view is complete…
  // …while the recorded ref for the filtered view renders at most 8 items in context
  const conv = store.get("p37-8")!;
  const filterRef = [...conv.results].reverse().find((r) => r.tool === "FILTER_TRAINS")!;
  const block = store.buildContextBlock(conv, "tNext", "2026-10-10");
  expect(filterRef.items!.length).toBeGreaterThan(8);
  expect(block).toContain("8) ");
  expect(block).not.toContain("9) 91"); // 9th filtered item NOT rendered
  expect(block).toContain("more in current results");
});

it("FILTER_TRAINS without any filter or sortBy is rejected by the schema", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "p37-9");
  expect(toolResultOf(await filterTurn(store, "p37-9", {})).status).toBe("invalid_arguments");
});

it("selection still validates against the FULL authoritative list, not the filtered view", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "p37-10");
  await filterTurn(store, "p37-10", { classCode: "3A" });
  // 91024 (CC/EC) is NOT in the filtered 3A view but IS in the authoritative list
  const ev = await drain(
    runTurn({
      conversationId: "p37-10",
      message: "91024 select karo",
      store,
      clientFactory: oneClient([tools("t1", "SELECT_TRAIN", { trainNumber: "91024" }), text("ok")]),
    }),
  );
  expect(toolResultOf(ev).status).toBe("ok");
  expect(store.get("p37-10")?.selection?.trainNumber).toBe("91024");
});

it("a newer search supersedes the filtered view and stale trains stay rejected (P35/36 protection intact)", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "p37-11");
  await filterTurn(store, "p37-11", { classCode: "3A" });
  await searchTurn(store, "p37-11", "2026-10-13"); // new date → supersedes search AND derived view
  const conv = store.get("p37-11")!;
  const filterRef = conv.results.find((r) => r.tool === "FILTER_TRAINS")!;
  expect(filterRef.supersededBy).toBeDefined();
  expect(filterRef.supersededReason).toContain("newer search results");
  const ev = await drain(
    runTurn({
      conversationId: "p37-11",
      message: "91005 select karo",
      store,
      clientFactory: oneClient([tools("t1", "SELECT_TRAIN", { trainNumber: "91005" }), text("ok")]),
    }),
  );
  expect(toolResultOf(ev).status).toBe("error"); // only in the superseded list
  expect(store.get("p37-11")?.selection).toBeUndefined();
});

it("a filter turn makes exactly the normal tool+text LLM calls — no second model call", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "p37-12");
  let calls = 0;
  const script = [tools("f1", "FILTER_TRAINS", { arrivesBefore: "12:00" }), text("ye rahi list")];
  const counting = {
    config: { provider: "fake", model: "fake", apiKey: "x", baseUrl: "y", timeoutMs: 5000 },
    async chat(): Promise<ChatResponse> {
      calls += 1;
      return script[Math.min(calls, script.length) - 1];
    },
  } as unknown as OpenAiCompatibleClient;
  await drain(runTurn({ conversationId: "p37-12", message: "subah pahunchne wali", store, clientFactory: () => counting }));
  expect(calls).toBe(2);
});

it("the LLM context shows classes of listed trains so class follow-ups resolve without re-search", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "p37-13");
  const block = store.buildContextBlock(store.get("p37-13")!, "tNext", "2026-10-10");
  expect(block).toContain("1) 91001 Filter Express 1 dep 04:00 arr 07:30 [3A,2A]");
  expect(block).toContain("[SL]");
});
