/**
 * PROMPT 32 — full booking-preparation acceptance audit (deterministic).
 * Every test here uses controlled fixtures / test doubles; live-provider
 * verification stays in the env-gated live-verify file and scripts/live-*.mjs.
 * Matrix items map to P32 §9 A–R (O/P/Q also lean on re-run existing suites).
 */
import { readdirSync } from "node:fs";
import { expect, it } from "vitest";
import {
  ConversationStore,
  REQUIRED_PASSENGER_FIELDS,
  type SelectionState,
} from "@/assistant/context/store";
import { evaluateReadiness, IRCTC_HANDOFF_READY } from "@/assistant/booking/preparation";
import { POST } from "@/app/api/passenger/route";
import { conversationStore } from "@/assistant/context/store";
import { validatePassengerField } from "@/assistant/passengers/validate";
import { runTurn } from "@/assistant/orchestrator";
import type { OpenAiCompatibleClient, ChatRequest, ChatResponse } from "@/assistant/llm/client";

const SEL: SelectionState = {
  trainNumber: "12951",
  trainName: "Morning Express",
  from: "LDH",
  to: "NDLS",
  journeyDate: "2026-10-12",
  classes: ["SL", "3A", "2A"],
  classCode: "3A",
  selectedAt: "2026-10-11T00:00:00.000Z",
};

const FULL = { name: "Rahul Sharma", age: 28, gender: "male" as const, berth: "lower" };

function mkResult(tool: string, over: Record<string, unknown> = {}) {
  return {
    tool,
    correlationId: `c-${Math.random()}`,
    status: "ok",
    note: "fixture",
    retrievedAt: new Date().toISOString(),
    ...over,
  } as never;
}

function seed(store: ConversationStore, id: string, pax: Record<string, unknown> = FULL) {
  store.setSelection(id, SEL);
  expect(store.updatePassenger(id, 1, pax).ok).toBe(true);
}

function api(body: Record<string, unknown>) {
  return POST(
    new Request("http://local/api/passenger", { method: "POST", body: JSON.stringify(body) }),
  );
}

/* A — each required field missing individually blocks review */
it("A: each required field missing alone blocks review and is named", () => {
  for (const field of REQUIRED_PASSENGER_FIELDS) {
    const store = new ConversationStore();
    const partial = { ...FULL } as Record<string, unknown>;
    delete partial[field];
    seed(store, `p32-a-${field}`, partial);
    const r = evaluateReadiness(store.get(`p32-a-${field}`)!);
    expect(r.ready, `field=${field}`).toBe(false);
    expect(r.missingFields, `field=${field}`).toContain(`passenger 1: ${field}`);
    expect(store.buildReview(`p32-a-${field}`).ok).toBe(false);
  }
});

/* B — all fields missing simultaneously: blocked, exact list */
it("B: empty passenger blocks review and lists every required field", () => {
  const store = new ConversationStore();
  store.setSelection("p32-b", SEL);
  expect(store.updatePassenger("p32-b", 1, {}).ok).toBe(true);
  const r = evaluateReadiness(store.get("p32-b")!);
  expect(r.ready).toBe(false);
  for (const f of REQUIRED_PASSENGER_FIELDS) expect(r.missingFields).toContain(`passenger 1: ${f}`);
  expect(store.buildReview("p32-b").ok).toBe(false);
});

/* C — invalid values rejected per existing schema (validator + API) */
it("C: invalid name/age/gender/berth are rejected by existing validation", async () => {
  expect(validatePassengerField("name", "x").ok).toBe(false);
  expect(validatePassengerField("age", "280").ok).toBe(false);
  expect(validatePassengerField("age", 12.5).ok).toBe(false);
  expect(validatePassengerField("gender", "xyz").ok).toBe(false);
  expect(validatePassengerField("berth", "").ok).toBe(false);
  expect(validatePassengerField("berth", "z".repeat(41)).ok).toBe(false);
  const res = await api({ conversationId: "p32-acc-cc", field: "gender", value: "xyz" });
  expect(res.status).toBe(400);
  expect(conversationStore.get("p32-acc-cc")?.passengers[0]?.gender).toBeUndefined();
});

/* D — failed backend save never satisfies readiness */
it("D: a failed save does not mark the field complete nor satisfy readiness", async () => {
  seed(conversationStore, "p32-acc-dd", { name: "Rahul Sharma", age: 28, gender: "male" });
  const bad = await api({ conversationId: "p32-acc-dd", passengerIndex: 1, field: "berth", value: "z".repeat(41) });
  expect(bad.status).toBe(400);
  const r = evaluateReadiness(conversationStore.get("p32-acc-dd")!);
  expect(r.ready).toBe(false);
  expect(r.missingFields).toContain("passenger 1: berth");
  expect(conversationStore.buildReview("p32-acc-dd").ok).toBe(false);
});

/* E — valid form permits review when everything else is ready */
it("E: complete valid form permits review (store + API)", async () => {
  const store = new ConversationStore();
  seed(store, "p32-e");
  expect(evaluateReadiness(store.get("p32-e")!).ready).toBe(true);
  expect(store.buildReview("p32-e").ok).toBe(true);

  seed(conversationStore, "p32-acc-e2");
  const rv = await api({ conversationId: "p32-acc-e2", action: "review" });
  expect(rv.status).toBe(200);
});

/* F — multi-passenger: every passenger validated independently */
it("F: second passenger's missing fields block review independently", () => {
  const store = new ConversationStore();
  seed(store, "p32-f");
  expect(store.addPassenger("p32-f").ok).toBe(true);
  expect(store.updatePassenger("p32-f", 2, { name: "Meera Sharma", age: 26, gender: "female" }).ok).toBe(true);
  const r = evaluateReadiness(store.get("p32-f")!);
  expect(r.ready).toBe(false);
  expect(r.missingFields).toEqual(["passenger 2: berth"]); // p1 complete, p2 not
  expect(store.buildReview("p32-f").ok).toBe(false);
  expect(store.updatePassenger("p32-f", 2, { berth: "upper" }).ok).toBe(true);
  expect(evaluateReadiness(store.get("p32-f")!).ready).toBe(true);
});

/* G — passenger-count changes recalculate completeness */
it("G: adding a passenger recalculates readiness; incomplete current passenger blocks adds", () => {
  const store = new ConversationStore();
  store.setSelection("p32-g", SEL);
  expect(store.updatePassenger("p32-g", 1, { name: "Rahul Sharma" }).ok).toBe(true);
  expect(store.addPassenger("p32-g").ok).toBe(false); // current passenger incomplete
  seed(store, "p32-g2");
  expect(evaluateReadiness(store.get("p32-g2")!).ready).toBe(true);
  expect(store.addPassenger("p32-g2").ok).toBe(true); // count up → readiness drops
  expect(evaluateReadiness(store.get("p32-g2")!).ready).toBe(false);
});

/* H — direct API attempts cannot bypass backend readiness */
it("H: direct review/confirm API calls are rejected while incomplete", async () => {
  conversationStore.setSelection("p32-acc-hh", SEL);
  expect(conversationStore.updatePassenger("p32-acc-hh", 1, { name: "Rahul Sharma" }).ok).toBe(true);
  const rv = await api({ conversationId: "p32-acc-hh", action: "review" });
  expect(rv.status).toBe(400);
  const cf = await api({ conversationId: "p32-acc-hh", action: "confirm" });
  expect(cf.status).toBe(400);
});

/* I — stale fare/availability blocks review; failed lookups do not invalidate */
it("I: stale availability/fare block review; a FAILED lookup changes nothing", () => {
  const store = new ConversationStore();
  seed(store, "p32-i");
  expect(store.buildReview("p32-i").ok).toBe(true);
  // failed lookup: review must SURVIVE (no data returned, no fact changed)
  store.beginTurn("p32-i", "t1", "availability?");
  store.recordToolResult("p32-i", "t1", "CHECK_AVAILABILITY", { trainNumber: "12951", classCode: "3A" }, mkResult("CHECK_AVAILABILITY", { status: "error" }));
  expect(store.get("p32-i")?.review?.status).toBe("awaiting_confirmation");
  // stale data: review must NOT survive
  store.beginTurn("p32-i", "t2", "phir check karo");
  store.recordToolResult("p32-i", "t2", "CHECK_AVAILABILITY", { trainNumber: "12951", classCode: "3A" }, mkResult("CHECK_AVAILABILITY", { freshness: "stale" }));
  expect(store.get("p32-i")?.review).toBeUndefined();
  expect(evaluateReadiness(store.get("p32-i")!).blockers.map((b) => b.code)).toContain("STALE_AVAILABILITY");

  const fare = new ConversationStore();
  seed(fare, "p32-i2");
  fare.beginTurn("p32-i2", "t1", "fare?");
  fare.recordToolResult("p32-i2", "t1", "GET_FARE", { trainNumber: "12951", classCode: "3A" }, mkResult("GET_FARE", { freshness: "stale" }));
  expect(evaluateReadiness(fare.get("p32-i2")!).blockers.map((b) => b.code)).toContain("STALE_FARE");
  expect(fare.buildReview("p32-i2").ok).toBe(false);
});

/* J — every booking-critical change invalidates an existing review */
it("J: journey/date/train/class/passenger changes each invalidate the review", () => {
  const store = new ConversationStore();
  seed(store, "p32-j");
  store.beginTurn("p32-j", "t0", "trains");
  store.recordToolResult("p32-j", "t0", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-12" }, mkResult("SEARCH_TRAINS", { journeyDate: "2026-10-12", data: [] }));

  const rebuild = () => expect(store.buildReview("p32-j").ok).toBe(true);

  rebuild();
  expect(store.updatePassenger("p32-j", 1, { age: 29 }).ok).toBe(true); // saved detail
  expect(store.get("p32-j")?.review).toBeUndefined();

  rebuild();
  store.setSelectionClass("p32-j", "2A"); // class
  expect(store.get("p32-j")?.review).toBeUndefined();

  rebuild();
  store.setSelection("p32-j", { ...SEL, classCode: "2A", trainNumber: "12014" }); // train
  expect(store.get("p32-j")?.review).toBeUndefined();

  rebuild();
  store.beginTurn("p32-j", "t3", "kal ke trains"); // date change supersedes
  store.recordToolResult("p32-j", "t3", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-13" }, mkResult("SEARCH_TRAINS", { journeyDate: "2026-10-13", data: [] }));
  expect(store.get("p32-j")?.review).toBeUndefined();
  expect(store.get("p32-j")?.selection).toBeUndefined();

  // route (source/destination) change supersedes + clears selection
  const s2 = new ConversationStore();
  seed(s2, "p32-j2");
  s2.beginTurn("p32-j2", "t0", "trains");
  s2.recordToolResult("p32-j2", "t0", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-12" }, mkResult("SEARCH_TRAINS", { journeyDate: "2026-10-12", data: [] }));
  expect(s2.buildReview("p32-j2").ok).toBe(true);
  s2.beginTurn("p32-j2", "t1", "route badlo");
  s2.recordToolResult("p32-j2", "t1", "SEARCH_TRAINS", { from: "LDH", to: "ASR", date: "2026-10-12" }, mkResult("SEARCH_TRAINS", { journeyDate: "2026-10-12", data: [] }));
  expect(s2.get("p32-j2")?.review).toBeUndefined();
  expect(s2.get("p32-j2")?.selection).toBeUndefined();
});

/* K — a staled review cannot be confirmed */
it("K: confirm against a tampered/stale snapshot is rejected and invalidated", () => {
  const store = new ConversationStore();
  seed(store, "p32-k");
  expect(store.buildReview("p32-k").ok).toBe(true);
  store.get("p32-k")!.review!.snapshot = "tampered";
  const res = store.confirmReview("p32-k");
  expect(res.ok).toBe(false);
  expect(store.get("p32-k")?.review).toBeUndefined(); // invalidated, not confirmable
});

/* L — confirmation outside the pending state is rejected */
it("L: confirm with no review / after confirmation is rejected", () => {
  const store = new ConversationStore();
  expect(store.confirmReview("p32-l-none").ok).toBe(false);
  seed(store, "p32-l");
  expect(store.buildReview("p32-l").ok).toBe(true);
  expect(store.confirmReview("p32-l").ok).toBe(true);
  expect(store.confirmReview("p32-l").ok).toBe(false); // already confirmed
});

/* M — valid explicit confirmation reaches preparation-only handoff state */
it("M: explicit confirmation reaches IRCTC_HANDOFF_READY and states booking not executed", async () => {
  seed(conversationStore, "p32-acc-mm");
  expect((await api({ conversationId: "p32-acc-mm", action: "review" })).status).toBe(200);
  const cf = await api({ conversationId: "p32-acc-mm", action: "confirm" });
  expect(cf.status).toBe(200);
  const body = (await cf.json()) as { handoff?: string; review?: { status: string } };
  expect(body.handoff).toBe(IRCTC_HANDOFF_READY);
  expect(body.review?.status).toBe("confirmed");
});

/* N — conversational text alone cannot bypass the validated confirmation */
function recordingClient(script: ChatResponse[]) {
  const requests: ChatRequest[] = [];
  let n = 0;
  const stub = {
    config: { provider: "fake", model: "fake", apiKey: "x", baseUrl: "y", timeoutMs: 5000 },
    async chat(req: ChatRequest): Promise<ChatResponse> {
      requests.push(structuredClone(req));
      return script[Math.min(n++, script.length - 1)];
    },
  };
  return { factory: () => stub as unknown as OpenAiCompatibleClient, requests };
}
it("N: 'haan' over chat cannot confirm; no confirmation tool exists for the model", async () => {
  const store = new ConversationStore();
  seed(store, "p32-n");
  expect(store.buildReview("p32-n").ok).toBe(true);
  const rec = recordingClient([{ content: "Theek hai!", toolCalls: [], model: "fake", finishReason: "stop" }]);
  const ev: unknown[] = [];
  for await (const e of runTurn({ conversationId: "p32-n", message: "haan, confirm karo", store, clientFactory: rec.factory })) {
    ev.push(e);
  }
  expect(store.get("p32-n")?.review?.status).toBe("awaiting_confirmation"); // untouched
  const toolNames = (rec.requests[0]?.tools ?? []).map((t) => t.function.name);
  expect(toolNames.some((n2) => /CONFIRM|BOOK/i.test(n2))).toBe(false); // nothing to bypass with
});

/* R — no booking/payment/OTP/CAPTCHA execution surface exists */
it("R: API surface is read-only railway queries + assistant + passenger data; no booking routes", () => {
  const top = readdirSync("src/app/api").sort();
  // "voice" = server-side TTS proxy (Prompt 34 addendum); read-only railway
  // queries + assistant + passenger data + TTS — still no booking surface.
  expect(top).toEqual(["assistant", "health", "passenger", "railway", "voice"]);
  const railway = readdirSync("src/app/api/railway").sort();
  expect(railway).toEqual(["availability", "cancellations", "fare", "live-status", "pnr", "search", "stations", "timetable", "train"]);
  const store = new ConversationStore() as unknown as Record<string, unknown>;
  for (const m of ["book", "pay", "submitTicket", "cancelTicket", "irctcLogin", "processOtp", "processCaptcha", "generatePnr"]) {
    expect(store[m]).toBeUndefined();
  }
});
