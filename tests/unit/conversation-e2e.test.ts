import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import type { ChatResponse, OpenAiCompatibleClient } from "@/assistant/llm/client";
import { errorEnvelope, okEnvelope } from "@/providers/envelope";
import { providerError } from "@/domain/errors";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type {
  FareProvider,
  LiveStatus,
  LiveStatusProvider,
  ResultEnvelope,
  SeatAvailabilityProvider,
  SourceInfo,
  TimetableProvider,
  TrainSearchProvider,
} from "@/providers/types";

/**
 * Prompt 7 §2 — complete end-to-end conversation scenarios (A–D) across
 * Hinglish, Hindi and English.
 *
 * AUTOMATED TEST: providers are MOCKED fixtures and the LLM is a scripted
 * fake standing in for the model's decisions. Fixture data below is TEST
 * DATA ONLY — it must never be presented as live railway information.
 * Genuine live verification is done separately against real providers.
 *
 * The REAL orchestrator + REAL store + REAL executor run, proving the
 * mechanics each scenario depends on: context resolution, fresh retrieval
 * on date correction, general-knowledge answers without live calls, and
 * honest failure handling (not-configured, timeout, retry-after-error).
 */

const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: `docs/provider-terms.md#${id}`,
  authorization: "configured",
});

const calls = { search: 0, fare: 0, availability: 0, timetable: 0, live: 0 };
let liveShouldTimeout = false;

// TEST FIXTURE data (not live): ASR→NDLS, two trains
const TRAINS = [
  { trainNumber: "12014", trainName: "ASR SHTBDI", from: { code: "ASR", name: "Amritsar Jn" }, to: { code: "NDLS", name: "New Delhi" }, departure: "04:55", arrival: "10:55", classes: ["CC", "EC"] },
  { trainNumber: "12904", trainName: "GOLDEN TEMPLE M", from: { code: "ASR", name: "Amritsar Jn" }, to: { code: "NDLS", name: "New Delhi" }, departure: "18:55", arrival: "10:35", classes: ["1A", "2A", "3A", "SL"] },
];

const route = { from: { code: "ASR", name: "Amritsar Jn" }, to: { code: "NDLS", name: "New Delhi" } };

function adapters() {
  const search: TrainSearchProvider = {
    id: "e2e-search",
    capabilities: ["trainSearch"],
    termsRef: "docs/provider-terms.md#e2e-search",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async search(_q, ctx) {
      calls.search += 1;
      return okEnvelope({ data: TRAINS, source: src("e2e-search"), ttlSeconds: 300, requestId: ctx.requestId });
    },
  };
  const fare: FareProvider = {
    id: "e2e-fare",
    capabilities: ["fare"],
    termsRef: "docs/provider-terms.md#e2e-fare",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async fare(q, ctx) {
      calls.fare += 1;
      return okEnvelope({
        data: { trainNumber: q.trainId, classCode: q.classCode, ...route, baseFare: 1450, totalFare: 1620, currency: "INR" },
        source: src("e2e-fare"),
        ttlSeconds: 300,
        requestId: ctx.requestId,
      });
    },
  };
  const availability: SeatAvailabilityProvider = {
    id: "e2e-avail",
    capabilities: ["seatAvailability"],
    termsRef: "docs/provider-terms.md#e2e-avail",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async availability(q, ctx): Promise<ResultEnvelope<never>> {
      calls.availability += 1;
      return okEnvelope({
        data: {
          trainNumber: q.trainId,
          date: q.date,
          ...route,
          classes: [{ classCode: q.classCode ?? "3A", status: "WL 3", seatsText: "RLWL3/WL3", asOf: null }],
        },
        source: src("e2e-avail"),
        ttlSeconds: 60,
        requestId: ctx.requestId,
      }) as ResultEnvelope<never>;
    },
  };
  const timetable: TimetableProvider = {
    id: "e2e-sched",
    capabilities: ["timetable"],
    termsRef: "docs/provider-terms.md#e2e-sched",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async timetable(trainId, date, ctx) {
      calls.timetable += 1;
      return okEnvelope({
        data: {
          trainNumber: trainId,
          trainName: trainId === "12014" ? "ASR SHTBDI" : "GOLDEN TEMPLE M",
          date: date ?? "2026-10-10",
          entries: [
            { sequence: 1, station: { code: "ASR", name: "Amritsar Jn" }, arrival: null, departure: "18:55", platform: null },
            { sequence: 2, station: { code: "LDH", name: "Ludhiana Jn" }, arrival: "21:00", departure: "21:10", platform: null },
            { sequence: 3, station: { code: "NDLS", name: "New Delhi" }, arrival: "03:45", departure: "04:00", platform: null },
          ],
        },
        source: src("e2e-sched"),
        ttlSeconds: 21600,
        requestId: ctx.requestId,
      });
    },
  };
  const live: LiveStatusProvider = {
    id: "e2e-live",
    capabilities: ["liveStatus"],
    termsRef: "docs/provider-terms.md#e2e-live",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async liveStatus(trainId, _date, ctx): Promise<ResultEnvelope<LiveStatus>> {
      calls.live += 1;
      if (liveShouldTimeout) {
        return errorEnvelope({
          source: src("e2e-live"),
          errors: [providerError("TIMEOUT", "live status upstream timed out", { retryable: true })],
          requestId: ctx.requestId,
        }) as unknown as ResultEnvelope<LiveStatus>;
      }
      return okEnvelope({
        data: {
          trainNumber: trainId,
          trainName: "ASR SHTBDI",
          running: true,
          lastStation: { code: "UMB", name: "Ambala Cant" },
          delayMinutes: 15,
          updatedAt: "As of 5 mins ago",
        },
        source: src("e2e-live"),
        ttlSeconds: 60,
        requestId: ctx.requestId,
      });
    },
  };
  return [search, fare, availability, timetable, live];
}

const IDS = ["e2e-search", "e2e-fare", "e2e-avail", "e2e-sched", "e2e-live"];
const LLM_ENV = ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL"];

function registerAll(withAdapters: boolean) {
  process.env.RAILWAY_PROVIDER_IDS = withAdapters ? IDS.join(",") : "";
  for (const id of IDS) {
    process.env[`RAILWAY_PROVIDER_${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_KEY`] = `cred-${id}`;
    if (withAdapters) registerAdapter(adapters().find((a) => a.id === id)!);
  }
}

beforeEach(() => {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  registerAll(true);
  calls.search = calls.fare = calls.availability = calls.timetable = calls.live = 0;
  liveShouldTimeout = false;
});

afterEach(() => {
  for (const id of IDS) {
    unregisterAdapter(id);
    delete process.env[`RAILWAY_PROVIDER_${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_KEY`];
  }
  for (const k of [...LLM_ENV, "RAILWAY_PROVIDER_IDS"]) delete process.env[k];
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

const tools = (list: { id: string; name: string; args: Record<string, unknown> }[]): ChatResponse => ({
  content: null,
  toolCalls: list,
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

const results = (events: TurnEvent[]) =>
  events.filter((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>[];

describe("conversation E2E (Prompt 7 §2 — mocked fixtures + scripted LLM; NOT live data)", () => {
  it("Scenario A: search → morning fare → timetable → 3A availability → date correction (Hinglish)", async () => {
    const store = new ConversationStore();
    const conv = "e2e-a";

    const t1 = await turn(store, conv, "Amritsar se Delhi ki trains batao.", [
      tools([{ id: "c1", name: "SEARCH_TRAINS", args: { from: "Amritsar", to: "Delhi", date: "2026-10-11" } }]),
      text("Trains mil gayi."),
    ]);
    expect(results(t1.events)[0]).toMatchObject({ tool: "SEARCH_TRAINS", status: "ok", journeyDate: "2026-10-11" });

    const t2 = await turn(store, conv, "Subah wali ka fare batao.", [
      tools([{ id: "c2", name: "GET_FARE", args: { trainNumber: "12014", from: "ASR", to: "NDLS", classCode: "CC" } }]),
      text("Fare ₹1620."),
    ]);
    expect(results(t2.events)[0]).toMatchObject({ tool: "GET_FARE", status: "ok" });

    const t3 = await turn(store, conv, "Doosri wali ka timetable?", [
      tools([{ id: "c3", name: "GET_TIMETABLE", args: { trainNumber: "12904" } }]),
      text("Timetable ye hai."),
    ]);
    expect(results(t3.events)[0]).toMatchObject({ tool: "GET_TIMETABLE", status: "ok" });

    const t4 = await turn(store, conv, "Ismein 3A available hai?", [
      tools([{ id: "c4", name: "CHECK_AVAILABILITY", args: { trainNumber: "12904", date: "2026-10-11", from: "ASR", to: "NDLS", classCode: "3A" } }]),
      text("3A mein WL 3."),
    ]);
    expect(results(t4.events)[0]).toMatchObject({ tool: "CHECK_AVAILABILITY", status: "ok" });

    // "Kal nahi, parso" → fresh search with corrected date; old list must not
    // be reused (stale results can never answer the newer request)
    const t5 = await turn(store, conv, "Kal nahi, parso check karo.", [
      tools([{ id: "c5", name: "SEARCH_TRAINS", args: { from: "ASR", to: "NDLS", date: "2026-10-12" } }]),
      text("Parso ki trains."),
    ]);
    expect(results(t5.events)[0]).toMatchObject({ tool: "SEARCH_TRAINS", status: "ok", journeyDate: "2026-10-12" });
    expect(calls.search).toBe(2); // second search actually hit the provider
    const block = store.buildContextBlock(store.get(conv)!, "tX", "2026-10-10");
    expect(block).toContain("2026-10-12");
    expect(block).not.toContain("date: 2026-10-11"); // superseded date gone from context
  });

  it("Scenario B: explicit train number → 'pichhle result wali train' route → 'usi ka fare'", async () => {
    const store = new ConversationStore();
    const conv = "e2e-b";

    const t1 = await turn(store, conv, "12014 abhi kahan hai?", [
      tools([{ id: "c1", name: "TRACK_TRAIN", args: { trainNumber: "12014", date: "2026-10-10" } }]),
      text("12014 Ambala cross kar chuki hai."),
    ]);
    expect(results(t1.events)[0]).toMatchObject({ tool: "TRACK_TRAIN", status: "ok", source: "e2e-live" });

    const t2 = await turn(store, conv, "Pichhle result wali train ka route batao.", [
      tools([{ id: "c2", name: "GET_TIMETABLE", args: { trainNumber: "12014" } }]),
      text("Route ye hai."),
    ]);
    expect(results(t2.events)[0]).toMatchObject({ tool: "GET_TIMETABLE", status: "ok" });

    const t3 = await turn(store, conv, "Usi ka fare kya hai?", [
      tools([{ id: "c3", name: "GET_FARE", args: { trainNumber: "12014", from: "ASR", to: "NDLS", classCode: "CC" } }]),
      text("Fare ₹1620."),
    ]);
    expect(results(t3.events)[0]).toMatchObject({ tool: "GET_FARE", status: "ok" });
    expect(calls.timetable).toBe(1);
    expect(calls.fare).toBe(1);
  });

  it("Scenario C (Hindi + English): general knowledge uses GENERAL_RAILWAY_ANSWER, zero live calls", async () => {
    const store = new ConversationStore();
    const before = { ...calls };

    const t1 = await turn(store, "e2e-c1", "RAC ka matlab kya hai?", [
      tools([{ id: "c1", name: "GENERAL_RAILWAY_ANSWER", args: { question: "RAC ka matlab kya hai?", language: "hi" } }]),
      text("RAC = Reservation Against Cancellation."),
    ]);
    expect(results(t1.events)[0]).toMatchObject({ tool: "GENERAL_RAILWAY_ANSWER", status: "ok" });

    const t2 = await turn(store, "e2e-c2", "What is the difference between Shatabdi and Vande Bharat?", [
      tools([{ id: "c2", name: "GENERAL_RAILWAY_ANSWER", args: { question: "difference between Shatabdi and Vande Bharat", language: "en" } }]),
      text("Shatabdi is loco-hauled; Vande Bharat is a self-propelled trainset."),
    ]);
    expect(results(t2.events)[0]).toMatchObject({ tool: "GENERAL_RAILWAY_ANSWER", status: "ok" });

    expect(calls).toEqual(before); // no live-data provider was touched
  });

  it("Scenario D1: search with NO provider configured → honest not_configured, model told not to invent", async () => {
    // tear down every adapter to simulate an unconfigured deployment
    for (const id of IDS) unregisterAdapter(id);
    process.env.RAILWAY_PROVIDER_IDS = "";

    const { events, requests } = await turn(new ConversationStore(), "e2e-d1", "Amritsar se Delhi ki trains batao.", [
      tools([{ id: "c1", name: "SEARCH_TRAINS", args: { from: "ASR", to: "NDLS", date: "2026-10-11" } }]),
      text("Live data abhi available nahi hai — provider configured nahi hai."),
    ]);
    const result = results(events)[0];
    expect(result).toMatchObject({ tool: "SEARCH_TRAINS", status: "not_configured" }); // NOT ok, NOT invented
    const toolMsg = requests[requests.length - 1].messages.find((m) => m.role === "tool");
    const content = String(toolMsg?.content);
    expect(content).toContain("not_configured");
    expect(content).toContain("Do NOT invent"); // anti-fabrication guidance reaches the model
  });

  it("Scenario D2: live-status timeout is surfaced honestly, and a repeat after recovery succeeds", async () => {
    liveShouldTimeout = true;
    const store = new ConversationStore();
    const conv = "e2e-d2";

    const t1 = await turn(store, conv, "12014 abhi kahan hai?", [
      tools([{ id: "c1", name: "TRACK_TRAIN", args: { trainNumber: "12014", date: "2026-10-10" } }]),
      text("Live status abhi nahi mil pa raha — thodi der baad try karein."),
    ]);
    const failed = results(t1.events)[0];
    expect(failed).toMatchObject({ tool: "TRACK_TRAIN", status: "error" }); // honest failure, no fake position
    const toolMsg = t1.requests[t1.requests.length - 1].messages.find((m) => m.role === "tool");
    expect(String(toolMsg?.content)).toContain("TIMEOUT");

    // provider recovers; repeating the same enquiry must succeed
    liveShouldTimeout = false;
    const t2 = await turn(store, conv, "Ab try karo.", [
      tools([{ id: "c2", name: "TRACK_TRAIN", args: { trainNumber: "12014", date: "2026-10-10" } }]),
      text("12014 ab Ambala Cant cross kar chuki hai, 15 min late."),
    ]);
    expect(results(t2.events)[0]).toMatchObject({ tool: "TRACK_TRAIN", status: "ok" });
  });

  it("Hindi (Devanagari) search request flows through the same mechanics", async () => {
    const store = new ConversationStore();
    const t = await turn(store, "e2e-hi", "अमृतसर से दिल्ली की ट्रेनें बताओ।", [
      tools([{ id: "c1", name: "SEARCH_TRAINS", args: { from: "Amritsar", to: "Delhi", date: "2026-10-11" } }]),
      text("ट्रेनें ये हैं."),
    ]);
    expect(results(t.events)[0]).toMatchObject({ tool: "SEARCH_TRAINS", status: "ok" });
    const message = t.events.find((e) => e.type === "message") as Extract<TurnEvent, { type: "message" }>;
    expect(message.cards).toHaveLength(2); // UI cards derived from provider rows
    expect(message.cards[0].trainNumber).toBe("12014"); // exact provider train number preserved
    expect(message.cards[1].trainName).toBe("GOLDEN TEMPLE M"); // exact provider name preserved
  });

  it("English request with 'tomorrow' passes an explicit date to the provider", async () => {
    const store = new ConversationStore();
    const t = await turn(store, "e2e-en", "Show me trains from Amritsar to Delhi tomorrow.", [
      tools([{ id: "c1", name: "SEARCH_TRAINS", args: { from: "Amritsar", to: "Delhi", date: "2026-10-11" } }]),
      text("Here are the trains."),
    ]);
    expect(results(t.events)[0]).toMatchObject({ tool: "SEARCH_TRAINS", status: "ok", journeyDate: "2026-10-11" });
  });
});
