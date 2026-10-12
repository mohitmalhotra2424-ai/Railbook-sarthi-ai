import { afterEach, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import type { ChatResponse, OpenAiCompatibleClient } from "@/assistant/llm/client";
import { executeTool } from "@/assistant/tools/executor";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type { ResultEnvelope, SourceInfo, TrainSearchProvider } from "@/providers/types";

/**
 * PROMPT 38 — availableOnly performs REAL provider availability checks across
 * the current result set (bounded concurrency, honest three-state outcomes:
 * available / unavailable / unknown). Mock adapter — deterministic; live
 * staging evidence is recorded separately in the report (mocks never prove
 * live provider behaviour).
 */

const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: `docs/provider-terms.md#${id}`,
  authorization: "configured",
});

const pad = (n: number) => String(n).padStart(2, "0");
const ROW_COUNT = 12;
const ROWS = Array.from({ length: ROW_COUNT }, (_, i) => ({
  trainNumber: String(92001 + i),
  trainName: `Avail Express ${i + 1}`,
  from: { code: "LDH", name: "Ludhiana" },
  to: { code: "NDLS", name: "Delhi" },
  departure: `${pad(5 + i)}:15`,
  arrival: `${pad(9 + i)}:45`,
  classes: ["3A", "SL"],
}));

type Kind = "available" | "wl" | "error" | "ratelimit" | "timeout" | "noclass";
type AvailCall = { trainId: string; date?: string; from: string; to: string; classCode?: string };

const DEFAULT_SCRIPT: Record<string, Kind> = {
  "92001": "available",
  "92002": "available",
  "92003": "available",
  "92004": "wl",
  "92005": "wl",
  "92006": "wl",
  "92007": "wl",
  "92008": "error",
  "92009": "ratelimit",
  "92010": "timeout",
  "92011": "noclass",
  "92012": "available",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(script: Record<string, Kind>, rows: unknown[] = ROWS, date = "2026-10-12") {
  const state = { calls: [] as AvailCall[], inflight: 0, maxInflight: 0 };
  const adapter: TrainSearchProvider & {
    availability: (q: AvailCall, ctx: { requestId: string }) => Promise<ResultEnvelope<never>>;
  } = {
    id: "p38-avail",
    capabilities: ["trainSearch", "seatAvailability"],
    termsRef: "docs/provider-terms.md#p38-avail",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async search(_q, ctx): Promise<ResultEnvelope<never>> {
      return okEnvelope({ data: rows, source: src("p38-avail"), ttlSeconds: 300, requestId: ctx.requestId }) as ResultEnvelope<never>;
    },
    async availability(q, ctx): Promise<ResultEnvelope<never>> {
      state.calls.push(q);
      state.inflight += 1;
      state.maxInflight = Math.max(state.maxInflight, state.inflight);
      await sleep(8); // overlap so concurrency is observable
      state.inflight -= 1;
      const kind = script[q.trainId] ?? "error";
      const base = { source: src("p38-avail"), ttlSeconds: 300, requestId: ctx.requestId };
      if (kind === "timeout") throw new Error("simulated upstream timeout");
      if (kind === "error" || kind === "ratelimit") {
        return {
          data: null,
          ...base,
          retrievedAt: new Date().toISOString(),
          providerTimestamp: null,
          freshness: "fresh",
          errors: [{ code: kind === "ratelimit" ? "RATE_LIMITED" : "UPSTREAM_ERROR", message: `${kind} (simulated)`, retryable: kind === "ratelimit" }],
          confidence: "high",
        } as unknown as ResultEnvelope<never>;
      }
      const classes =
        kind === "noclass"
          ? []
          : [{ classCode: "3A", status: kind === "available" ? "AVAILABLE-5" : "WL 12", seatsText: null, asOf: null }];
      return okEnvelope({
        data: { trainNumber: q.trainId, date: date, from: { code: "LDH", name: "Ludhiana" }, to: { code: "NDLS", name: "Delhi" }, classes },
        ...base,
      }) as ResultEnvelope<never>;
    },
  };
  registerAdapter(adapter as unknown as TrainSearchProvider);
  return state;
}

const ENV_KEYS = ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL", "RAILWAY_PROVIDER_IDS", "RAILWAY_PROVIDER_P38_AVAIL_KEY"];
function envOn() {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  process.env.RAILWAY_PROVIDER_IDS = "p38-avail";
  process.env.RAILWAY_PROVIDER_P38_AVAIL_KEY = "cred";
}
afterEach(() => {
  unregisterAdapter("p38-avail");
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
      message: "available trains dikhao",
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

it("availableOnly runs REAL provider checks for every relevant train with correct class/route/date; only confirmed-available trains are listed", async () => {
  envOn();
  const state = setup(DEFAULT_SCRIPT);
  const store = new ConversationStore();
  await searchTurn(store, "p38-1");
  const ev = await filterTurn(store, "p38-1", { classCode: "3A", availableOnly: true });
  expect(toolResultOf(ev).status).toBe("ok");
  expect(state.calls).toHaveLength(ROW_COUNT); // every relevant train scheduled
  for (const c of state.calls) {
    expect(c.date).toBe("2026-10-12");
    expect(c.from).toBe("LDH");
    expect(c.to).toBe("NDLS");
    expect(c.classCode).toBe("3A");
  }
  expect(cardsOf(ev).map((c) => c.trainNumber)).toEqual(["92001", "92002", "92003", "92012"]);
  expect(cardsOf(ev)[0].availability?.[0]?.status).toBe("AVAILABLE-5");
});

it("partial failures are counted honestly: available / unavailable / could-not-verify (unknown ≠ unavailable)", async () => {
  envOn();
  setup(DEFAULT_SCRIPT);
  const store = new ConversationStore();
  await searchTurn(store, "p38-2");
  const res = await executeTool("FILTER_TRAINS", { classCode: "3A", availableOnly: true }, undefined, {
    conversationId: "p38-2",
    turnId: "t-exec",
    toolCallId: "c-exec",
    store,
  });
  expect(res.status).toBe("ok");
  expect(res.note).toContain("12 trains checked: 4 available, 4 unavailable, 4 could not be verified. Results are partial.");
});

it("zero-available is reported differently for complete vs incomplete checks", async () => {
  envOn();
  // (a) every train explicitly waitlisted → complete negative result
  const allWl: Record<string, Kind> = {};
  for (const r of ROWS) allWl[r.trainNumber] = "wl";
  setup(allWl);
  const storeA = new ConversationStore();
  await searchTurn(storeA, "p38-3a");
  const resA = await executeTool("FILTER_TRAINS", { classCode: "3A", availableOnly: true }, undefined, {
    conversationId: "p38-3a",
    turnId: "t",
    toolCallId: "c",
    store: storeA,
  });
  expect(resA.note).toContain("All 12 relevant trains verified for 3A: 0 confirmed available, 12 unavailable.");
  expect(resA.note).not.toContain("could not be verified");

  // (b) some waitlisted + some failed → cannot conclude "no train available"
  const mixed: Record<string, Kind> = {};
  ROWS.forEach((r, i) => (mixed[r.trainNumber] = i < 6 ? "wl" : "error"));
  unregisterAdapter("p38-avail");
  setup(mixed);
  const storeB = new ConversationStore();
  await searchTurn(storeB, "p38-3b");
  const resB = await executeTool("FILTER_TRAINS", { classCode: "3A", availableOnly: true }, undefined, {
    conversationId: "p38-3b",
    turnId: "t",
    toolCallId: "c",
    store: storeB,
  });
  expect(resB.note).toContain("none has confirmed 3A seats");
  expect(resB.note).toContain("CANNOT be concluded that no train is available");
});

it("bounded concurrency (≤3) and exactly one attempt per train — no floods, no retry storms on rate limits", async () => {
  envOn();
  const state = setup(DEFAULT_SCRIPT);
  const store = new ConversationStore();
  await searchTurn(store, "p38-4");
  await filterTurn(store, "p38-4", { classCode: "3A", availableOnly: true });
  expect(state.maxInflight).toBeLessThanOrEqual(3);
  expect(state.maxInflight).toBeGreaterThan(1); // actually concurrent, not serialized one-by-one
  expect(state.calls).toHaveLength(ROW_COUNT); // RATE_LIMITED/timeout trains were NOT retried
});

it("still-valid recorded checks are reused; an explicit refresh re-checks live", async () => {
  envOn();
  const state = setup(DEFAULT_SCRIPT);
  const store = new ConversationStore();
  await searchTurn(store, "p38-5");
  await filterTurn(store, "p38-5", { classCode: "3A", availableOnly: true });
  expect(state.calls).toHaveLength(ROW_COUNT);
  const again = await filterTurn(store, "p38-5", { classCode: "3A", availableOnly: true }); // reuse window
  // Confirmed outcomes are reused — only the 4 previously UNVERIFIED trains
  // (error/rate-limited/timeout/no-published-data) get one fresh bounded
  // attempt: transient failures may recover, and this is one try per request,
  // never a retry storm.
  expect(state.calls).toHaveLength(ROW_COUNT + 4);
  expect(state.calls.slice(ROW_COUNT).map((c) => c.trainId).sort()).toEqual(["92008", "92009", "92010", "92011"]);
  expect(cardsOf(again).map((c) => c.trainNumber)).toEqual(["92001", "92002", "92003", "92012"]); // same honest result
  await filterTurn(store, "p38-5", { classCode: "3A", availableOnly: true, refresh: true }); // explicit re-check
  expect(state.calls).toHaveLength(ROW_COUNT + 4 + ROW_COUNT); // refresh bypasses reuse entirely
});

it("a date change supersedes old checks — the new journey is checked fresh, old results never attach", async () => {
  envOn();
  const state = setup({ ...DEFAULT_SCRIPT, "93001": "available" });
  const store = new ConversationStore();
  await searchTurn(store, "p38-6");
  await filterTurn(store, "p38-6", { classCode: "3A", availableOnly: true });
  expect(state.calls).toHaveLength(ROW_COUNT);
  // new search for a new date returns a different single train
  const adapterRows = [{ trainNumber: "93001", trainName: "Next Day Express", from: { code: "LDH", name: "Ludhiana" }, to: { code: "NDLS", name: "Delhi" }, departure: "07:00", arrival: "11:00", classes: ["3A"] }];
  unregisterAdapter("p38-avail");
  const state2 = setup({ ...DEFAULT_SCRIPT, "93001": "available" }, adapterRows);
  await drain(
    runTurn({
      conversationId: "p38-6",
      message: "13 October ki trains",
      store,
      clientFactory: oneClient([tools("s2", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-13" }), text("ok")]),
    }),
  );
  const ev = await filterTurn(store, "p38-6", { classCode: "3A", availableOnly: true });
  expect(state2.calls.map((c) => c.trainId)).toEqual(["93001"]); // only the NEW set checked
  expect(state2.calls[0].date).toBe("2026-10-13");
  expect(cardsOf(ev).map((c) => c.trainNumber)).toEqual(["93001"]);
});

it("without any known class the tool asks for clarification — never guesses", async () => {
  envOn();
  const state = setup(DEFAULT_SCRIPT);
  const store = new ConversationStore();
  await searchTurn(store, "p38-7");
  const res = await executeTool("FILTER_TRAINS", { availableOnly: true }, undefined, {
    conversationId: "p38-7",
    turnId: "t",
    toolCallId: "c",
    store,
  });
  expect(res.status).toBe("error");
  expect(res.note).toContain("which class");
  expect(state.calls).toHaveLength(0); // nothing checked on a guess
});

it("the class falls back to the current selection when the turn does not state one", async () => {
  envOn();
  const state = setup(DEFAULT_SCRIPT);
  const store = new ConversationStore();
  await searchTurn(store, "p38-8");
  store.setSelection("p38-8", {
    trainNumber: "92002",
    from: "LDH",
    to: "NDLS",
    journeyDate: "2026-10-12",
    classes: ["3A", "SL"],
    classCode: "3A",
    selectedAt: new Date().toISOString(),
  });
  const ev = await filterTurn(store, "p38-8", { availableOnly: true });
  expect(state.calls[0].classCode).toBe("3A");
  expect(cardsOf(ev).map((c) => c.trainNumber)).toContain("92002");
});

it("plain filters never call the availability provider; selection from the filtered view still uses the full authoritative list", async () => {
  envOn();
  const state = setup(DEFAULT_SCRIPT);
  const store = new ConversationStore();
  await searchTurn(store, "p38-9");
  await filterTurn(store, "p38-9", { classCode: "3A" }); // plain class filter
  expect(state.calls).toHaveLength(0);
  await filterTurn(store, "p38-9", { classCode: "3A", availableOnly: true });
  const ev = await drain(
    runTurn({
      conversationId: "p38-9",
      message: "92012 select karo",
      store,
      clientFactory: oneClient([tools("t1", "SELECT_TRAIN", { trainNumber: "92012" }), text("ok")]),
    }),
  );
  expect(toolResultOf(ev).status).toBe("ok");
  expect(store.get("p38-9")?.selection?.trainNumber).toBe("92012");
  // a train EXCLUDED from the available view remains selectable from the authoritative list
  const ev2 = await drain(
    runTurn({
      conversationId: "p38-9",
      message: "92004 select karo",
      store,
      clientFactory: oneClient([tools("t2", "SELECT_TRAIN", { trainNumber: "92004" }), text("ok")]),
    }),
  );
  expect(toolResultOf(ev2).status).toBe("ok"); // waitlisted ≠ nonexistent
});

it("real ConfirmTkt/IRCTC status vocabulary is classified correctly: AVL variants = available, WL/RAC/REGRET = unavailable", async () => {
  envOn();
  // statuses delivered verbatim from the provider payload
  const rawRows = [
    { n: "92101", status: "AVL 18" },
    { n: "92102", status: "AVAILABLE-5" },
    { n: "92103", status: "RAC 2" },
    { n: "92104", status: "GNWL 3/WL 1" },
    { n: "92105", status: "Regret" },
  ];
  const state = { calls: [] as AvailCall[], inflight: 0, maxInflight: 0 };
  const adapter: TrainSearchProvider & { availability: (q: AvailCall, ctx: { requestId: string }) => Promise<ResultEnvelope<never>> } = {
    id: "p38-avail",
    capabilities: ["trainSearch", "seatAvailability"],
    termsRef: "docs/provider-terms.md#p38-avail",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async search(_q, ctx) {
      return okEnvelope({
        data: rawRows.map((r) => ({
          trainNumber: r.n,
          trainName: "Vocab Test",
          from: { code: "LDH", name: "Ludhiana" },
          to: { code: "NDLS", name: "Delhi" },
          departure: "08:00",
          arrival: "12:00",
          classes: ["3A"],
        })),
        source: src("p38-avail"),
        ttlSeconds: 300,
        requestId: ctx.requestId,
      }) as ResultEnvelope<never>;
    },
    async availability(q, ctx) {
      state.calls.push(q as AvailCall);
      const row = rawRows.find((r) => r.n === q.trainId)!;
      return okEnvelope({
        data: { trainNumber: q.trainId, date: "2026-10-12", from: { code: "LDH", name: "Ludhiana" }, to: { code: "NDLS", name: "Delhi" }, classes: [{ classCode: "3A", status: row.status, seatsText: row.status, asOf: null }] },
        source: src("p38-avail"),
        ttlSeconds: 300,
        requestId: ctx.requestId,
      }) as ResultEnvelope<never>;
    },
  };
  registerAdapter(adapter as unknown as TrainSearchProvider);
  const store = new ConversationStore();
  await searchTurn(store, "p38-11");
  const ev = await filterTurn(store, "p38-11", { classCode: "3A", availableOnly: true });
  expect(cardsOf(ev).map((c) => c.trainNumber)).toEqual(["92101", "92102"]); // only AVL variants
  const res = await executeTool("FILTER_TRAINS", { classCode: "3A", availableOnly: true }, undefined, {
    conversationId: "p38-11",
    turnId: "t",
    toolCallId: "c",
    store,
  });
  expect(res.note).toContain("All 5 relevant trains verified for 3A: 2 confirmed available, 3 unavailable.");
});

it("confirmed outcomes are stored on the search-version ref; failures are never stored as facts; the authoritative ref list stays intact", async () => {
  envOn();
  setup(DEFAULT_SCRIPT);
  const store = new ConversationStore();
  await searchTurn(store, "p38-10");
  await filterTurn(store, "p38-10", { classCode: "3A", availableOnly: true });
  const conv = store.get("p38-10")!;
  const searchRef = conv.results.find((r) => r.tool === "SEARCH_TRAINS")!;
  expect(searchRef.supersededBy).toBeUndefined(); // batch must NOT evict the authoritative search ref
  const batch = searchRef.availabilityBatch?.find((b) => b.classCode === "3A");
  expect(batch).toBeDefined();
  expect(Object.keys(batch!.entries).sort()).toEqual(["92001", "92002", "92003", "92004", "92005", "92006", "92007", "92012"]); // 4 available + 4 waitlisted (ok responses only)
  expect(batch!.entries["92001"]).toBe("AVAILABLE-5");
  expect(batch!.entries["92004"]).toBe("WL 12");
  expect("92008" in batch!.entries).toBe(false); // errored check NOT stored
  expect("92010" in batch!.entries).toBe(false); // timed-out check NOT stored
});
