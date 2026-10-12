import { afterEach, beforeEach, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import { LlmTimeoutError, type ChatRequest, type ChatResponse, type OpenAiCompatibleClient } from "@/assistant/llm/client";
import { TOOL_ARG_SCHEMAS } from "@/assistant/tools/schemas";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type { ResultEnvelope, SourceInfo, TrainSearchProvider } from "@/providers/types";

/**
 * PROMPT 29 — age-only argument compatibility + strict age-only recovery
 * boundary (Tests A–N). Deterministic: scripted/recording LLM doubles and a
 * fixture provider. No live calls in this file.
 */

const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: "t",
  authorization: "configured",
});
function fixtureAdapter(): TrainSearchProvider {
  return {
    id: "a29-search",
    capabilities: ["trainSearch"],
    termsRef: "t",
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
        source: src("a29-search"),
        ttlSeconds: 300,
        requestId: ctx.requestId,
      }) as ResultEnvelope<never>;
    },
  };
}

type Step = ChatResponse | (() => Promise<ChatResponse>);
function recordingClient(steps: Step[]): { factory: () => OpenAiCompatibleClient; requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  let n = 0;
  const stub = {
    config: { provider: "fake", model: "fake", apiKey: "x", baseUrl: "y", timeoutMs: 5000 },
    async chat(req: ChatRequest): Promise<ChatResponse> {
      requests.push(structuredClone(req));
      const step = steps[Math.min(n, steps.length - 1)];
      n += 1;
      return typeof step === "function" ? step() : step;
    },
  };
  return { factory: () => stub as unknown as OpenAiCompatibleClient, requests };
}

const tools = (id: string, name: string, args: Record<string, unknown>): ChatResponse => ({
  content: null,
  toolCalls: [{ id, name, args }],
  model: "fake",
  finishReason: "tool_calls",
});
const text = (t: string): ChatResponse => ({ content: t, toolCalls: [], model: "fake", finishReason: "stop" });

const LLM_ENV = ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL", "RAILWAY_PROVIDER_IDS", "RAILWAY_PROVIDER_A29_SEARCH_KEY"];
beforeEach(() => {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  process.env.RAILWAY_PROVIDER_IDS = "a29-search";
  process.env.RAILWAY_PROVIDER_A29_SEARCH_KEY = "cred";
  registerAdapter(fixtureAdapter());
});
afterEach(() => {
  unregisterAdapter("a29-search");
  for (const k of LLM_ENV) delete process.env[k];
});

async function drain(run: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of run) out.push(e);
  return out;
}

async function setupUntilNameSaved(store: ConversationStore, cid: string) {
  const s1 = recordingClient([
    tools("s1", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-12" }),
    text("Ye trains hain."),
  ]);
  await drain(runTurn({ conversationId: cid, message: "trains dikhao", store, clientFactory: s1.factory }));
  const s2 = recordingClient([
    tools("a", "SELECT_TRAIN", { trainNumber: "12951" }),
    tools("b", "SELECT_CLASS", { classCode: "3A" }),
    text("Train aur class select ho gayi. Naam bataiye."),
  ]);
  await drain(runTurn({ conversationId: cid, message: "select karo", store, clientFactory: s2.factory }));
  const s3 = recordingClient([
    tools("n", "UPDATE_PASSENGER", { field: "name", value: "Rahul Sharma" }),
    text("Naam save ho gaya. Ab age bataiye."),
  ]);
  await drain(runTurn({ conversationId: cid, message: "Rahul Sharma", store, clientFactory: s3.factory }));
  expect(store.get(cid)?.passengers[0]?.name).toBe("Rahul Sharma");
}

const messageText = (ev: TurnEvent[]): string =>
  (ev.find((e) => e.type === "message") as Extract<TurnEvent, { type: "message" }> | undefined)?.text ?? "";
const toolStatuses = (ev: TurnEvent[]): string[] =>
  (ev.filter((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>[]).map((t) => `${t.tool}:${t.status}`);

/* ===== A — the exact Prompt 28 live failure, now fixed ===== */

it("A: numeric age 28 from a recovery response passes validation and saves (P28 failure fixed)", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "a29-a");
  const rec = recordingClient([
    text("Age 28 save ho gaya."),
    // Verbatim shape from the P28 live log: value as a JSON number.
    tools("u", "UPDATE_PASSENGER", { passenger: 1, field: "age", value: 28 }),
    text("Age 28 save ho gaya."),
  ]);
  const ev = await drain(runTurn({ conversationId: "a29-a", message: "Age 28.", store, clientFactory: rec.factory }));
  expect(toolStatuses(ev)).toEqual(["UPDATE_PASSENGER:ok"]);
  expect(store.get("a29-a")?.passengers[0]).toMatchObject({ name: "Rahul Sharma", age: 28 });
  expect(messageText(ev)).toBe("Age 28 save ho gaya."); // truthful, evidence-backed
});

/* ===== B — string age still works ===== */

it("B: string age \"28\" continues to work unchanged", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "a29-b");
  const ev = await drain(
    runTurn({
      conversationId: "a29-b",
      message: "Age 28.",
      store,
      clientFactory: recordingClient([tools("u", "UPDATE_PASSENGER", { field: "age", value: "28" }), text("saved")]).factory,
    }),
  );
  expect(toolStatuses(ev)).toEqual(["UPDATE_PASSENGER:ok"]);
  expect(store.get("a29-b")?.passengers[0]?.age).toBe(28);
});

/* ===== C — invalid numeric and string ages rejected ===== */

it("C: out-of-range numeric and malformed string ages are rejected; form unchanged", async () => {
  for (const bad of [280, -5, "280", "abc", "", "2years", "2.5"]) {
    const store = new ConversationStore();
    await setupUntilNameSaved(store, `a29-c-${String(bad)}`);
    const ev = await drain(
      runTurn({
        conversationId: `a29-c-${String(bad)}`,
        message: "age",
        store,
        clientFactory: recordingClient([tools("u", "UPDATE_PASSENGER", { field: "age", value: bad }), text("retry")]).factory,
      }),
    );
    expect(toolStatuses(ev)).toEqual(["UPDATE_PASSENGER:invalid_arguments"]);
    expect(store.get(`a29-c-${String(bad)}`)?.passengers[0]?.age).toBeUndefined();
  }
});

/* ===== D — unsupported value types rejected at the schema boundary ===== */

it("D: booleans, null, arrays, objects and floats are rejected — only integer numbers normalize", () => {
  const schema = TOOL_ARG_SCHEMAS.UPDATE_PASSENGER;
  // Integer age normalizes to the existing string contract.
  expect(schema.safeParse({ field: "age", value: 28 }).success).toBe(true);
  expect(schema.safeParse({ field: "age", value: 28 }).data).toMatchObject({ value: "28" });
  // Everything else is rejected by the strict schema (no silent coercion).
  for (const bad of [true, false, null, [28], { v: 28 }, 28.5, -2.5]) {
    expect(schema.safeParse({ field: "age", value: bad }).success).toBe(false);
  }
  // Numeric values for OTHER fields are NOT coerced.
  expect(schema.safeParse({ field: "name", value: 123 }).success).toBe(false);
  expect(schema.safeParse({ field: "gender", value: 1 }).success).toBe(false);
  expect(schema.safeParse({ field: "berth", value: 2 }).success).toBe(false);
  // Passenger index rules unchanged.
  expect(schema.safeParse({ passenger: 7, field: "age", value: 28 }).success).toBe(false);
  expect(schema.safeParse({ passenger: 1.5, field: "age", value: 28 }).success).toBe(false);
});

/* ===== E — recovery eligibility: form open + age missing + age claim ===== */

it("E: recovery runs only when the form is open, age is missing, and an age save-claim was blocked", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "a29-e");
  const rec = recordingClient([
    text("Age 28 save ho gaya."),
    tools("u", "UPDATE_PASSENGER", { field: "age", value: "28" }),
    text("Age 28 save ho gaya."),
  ]);
  const ev = await drain(runTurn({ conversationId: "a29-e", message: "Age 28.", store, clientFactory: rec.factory }));
  expect(rec.requests.length).toBeGreaterThanOrEqual(2); // recovery fired
  const recoveryNote = rec.requests[1]?.messages.at(-1);
  expect(recoveryNote?.role).toBe("system");
  expect(recoveryNote?.content).toContain("RECOVERY");
  expect(messageText(ev)).toBe("Age 28 save ho gaya.");
  expect(store.get("a29-e")?.passengers[0]?.age).toBe(28);
});

/* ===== F — name/gender claims never trigger recovery ===== */

it("F: unsupported name or gender save claims never trigger the age-only recovery", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "a29-f");
  // Gender claim (gender is genuinely missing) — blocked, but NOT recoverable.
  const g = recordingClient([text("Gender male save ho gaya.")]);
  const evG = await drain(runTurn({ conversationId: "a29-f", message: "Male", store, clientFactory: g.factory }));
  expect(g.requests).toHaveLength(1); // no second request
  expect(messageText(evG)).not.toMatch(/save ho gaya/i);
  expect(store.get("a29-f")?.passengers[0]?.gender).toBeUndefined();
  // Name mismatch claim — blocked, not recoverable.
  const n = recordingClient([text("Priya ka naam save ho gaya.")]);
  const evN = await drain(runTurn({ conversationId: "a29-f", message: "Priya", store, clientFactory: n.factory }));
  expect(n.requests).toHaveLength(1);
  expect(messageText(evN)).not.toMatch(/save ho gaya/i);
  expect(store.get("a29-f")?.passengers[0]?.name).toBe("Rahul Sharma"); // unchanged
});

/* ===== G — no other passenger field can trigger recovery ===== */

it("G: berth (request-only) claims are blocked without recovery", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "a29-g");
  const rec = recordingClient([text("Lower berth save ho gaya.")]);
  const ev = await drain(runTurn({ conversationId: "a29-g", message: "lower berth", store, clientFactory: rec.factory }));
  expect(rec.requests).toHaveLength(1); // berth is NOT recovery-eligible
  expect(messageText(ev)).not.toMatch(/save ho gaya/i);
  expect(store.get("a29-g")?.passengers[0]?.berth).toBeUndefined();
});

/* ===== H — railway tools and general conversation never trigger recovery ===== */

it("H: railway tool turns and general Q&A never trigger recovery", async () => {
  const store = new ConversationStore();
  // Search turn with a tool call — normal flow, no recovery involvement.
  const s = recordingClient([
    tools("s1", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-12" }),
    text("Ye trains hain."),
  ]);
  await drain(runTurn({ conversationId: "a29-h", message: "trains dikhao", store, clientFactory: s.factory }));
  expect(s.requests).toHaveLength(2); // tool turn + final answer only
  // General question mid-flow.
  await setupUntilNameSaved(store, "a29-h");
  const q = recordingClient([text("12951 subah 06:15 par chalti hai.")]);
  const ev = await drain(runTurn({ conversationId: "a29-h", message: "Train kab chalti hai?", store, clientFactory: q.factory }));
  expect(q.requests).toHaveLength(1);
  expect(messageText(ev)).toBe("12951 subah 06:15 par chalti hai.");
});

/* ===== I — already-saved age never triggers recovery ===== */

it("I: age already authoritatively saved → truthful confirmation, no recovery", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "a29-i");
  const s = recordingClient([tools("u", "UPDATE_PASSENGER", { field: "age", value: 28 }), text("Age save ho gaya.")]);
  await drain(runTurn({ conversationId: "a29-i", message: "Age 28.", store, clientFactory: s.factory }));
  const rec = recordingClient([text("Aapki age 28 save ho chuki hai.")]);
  const ev = await drain(runTurn({ conversationId: "a29-i", message: "Age save hai na?", store, clientFactory: rec.factory }));
  expect(rec.requests).toHaveLength(1);
  expect(messageText(ev)).toBe("Aapki age 28 save ho chuki hai.");
});

/* ===== J — one-extra-request limit still enforced ===== */

it("J: repeated blocked age claims still total exactly ONE recovery request", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "a29-j");
  const rec = recordingClient([
    text("Age 28 save ho gaya."),
    text("Age 28 save ho gaya, pakka."),
  ]);
  const ev = await drain(runTurn({ conversationId: "a29-j", message: "Age 28.", store, clientFactory: rec.factory }));
  expect(rec.requests).toHaveLength(2); // never a third
  expect(messageText(ev)).toMatch(/Age abhi save confirm nahi hui/);
});

/* ===== K — recovery failure keeps the honest fallback ===== */

it("K: recovery timeout → honest fallback, no false confirmation", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "a29-k");
  const rec = recordingClient([
    text("Age 28 save ho gaya."),
    async () => {
      throw new LlmTimeoutError("fake", 5000);
    },
  ]);
  const ev = await drain(runTurn({ conversationId: "a29-k", message: "Age 28.", store, clientFactory: rec.factory }));
  expect(ev.find((e) => e.type === "error")).toBeUndefined();
  expect(messageText(ev)).not.toMatch(/save ho gaya/i);
  expect(messageText(ev)).toMatch(/Age abhi save confirm nahi hui/);
  expect(store.get("a29-k")?.passengers[0]?.age).toBeUndefined();
});

/* ===== L — confirmation only from authoritative evidence ===== */

it("L: after a numeric-age save, the confirmation is permitted by evidence; before it, blocked", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "a29-l");
  // Before any success, the same sentence is blocked.
  const blocked = recordingClient([text("Age 28 save ho gaya.")]);
  const ev1 = await drain(
    runTurn({
      conversationId: "a29-l",
      message: "Age 28.",
      store,
      // recovery attempt also plain text → stays blocked
      clientFactory: blocked.factory,
    }),
  );
  expect(messageText(ev1)).not.toMatch(/save ho gaya/i);
  // After a verified numeric save, the identical sentence is permitted.
  const okTurn = recordingClient([tools("u", "UPDATE_PASSENGER", { field: "age", value: 28 }), text("Age 28 save ho gaya.")]);
  const ev2 = await drain(runTurn({ conversationId: "a29-l", message: "Age 28.", store, clientFactory: okTurn.factory }));
  expect(messageText(ev2)).toBe("Age 28 save ho gaya.");
  expect(store.get("a29-l")?.passengers[0]?.age).toBe(28);
});

/* ===== M — existing passenger validation + unrelated tools unchanged ===== */

it("M: other tools' schemas untouched; passenger validation still authoritative", () => {
  // Spot-check unrelated tool schemas remain strict.
  expect(TOOL_ARG_SCHEMAS.SEARCH_TRAINS.safeParse({ from: "LDH", to: "NDLS", date: "2026-10-12" }).success).toBe(true);
  expect(TOOL_ARG_SCHEMAS.SEARCH_TRAINS.safeParse({ from: "LDH", to: "NDLS", date: "12-10-2026" }).success).toBe(false);
  expect(TOOL_ARG_SCHEMAS.GET_TRAIN_INFO.safeParse({ trainNumber: "12951" }).success).toBe(true);
  // Baseline behaviour (pre-existing numericString union, untouched here):
  expect(TOOL_ARG_SCHEMAS.GET_TRAIN_INFO.safeParse({ trainNumber: 12951 }).success).toBe(true);
  expect(TOOL_ARG_SCHEMAS.GET_TRAIN_INFO.safeParse({ trainNumber: "12" }).success).toBe(false);
  expect(TOOL_ARG_SCHEMAS.SELECT_CLASS.safeParse({ classCode: "3A" }).success).toBe(true);
  // Age rule boundaries unchanged after normalization.
  expect(TOOL_ARG_SCHEMAS.UPDATE_PASSENGER.safeParse({ field: "age", value: 120 }).success).toBe(true);
  expect(TOOL_ARG_SCHEMAS.UPDATE_PASSENGER.safeParse({ field: "age", value: 121 }).success).toBe(true); // schema ok; validateAge rejects at execution
});

it("M2: numeric 121 is rejected at execution (range rule lives in validateAge, unchanged)", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "a29-m2");
  const ev = await drain(
    runTurn({
      conversationId: "a29-m2",
      message: "age",
      store,
      clientFactory: recordingClient([tools("u", "UPDATE_PASSENGER", { field: "age", value: 121 }), text("retry")]).factory,
    }),
  );
  expect(toolStatuses(ev)).toEqual(["UPDATE_PASSENGER:invalid_arguments"]);
  expect(store.get("a29-m2")?.passengers[0]?.age).toBeUndefined();
});

/* ===== N — single final-message emission (text + voice share it) ===== */

it("N: numeric-age recovery turn emits exactly ONE message event", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "a29-n");
  const rec = recordingClient([
    text("Age 28 save ho gaya."),
    tools("u", "UPDATE_PASSENGER", { field: "age", value: 28 }),
    text("Age 28 save ho gaya."),
  ]);
  const ev = await drain(runTurn({ conversationId: "a29-n", message: "Age 28.", store, clientFactory: rec.factory }));
  expect(ev.filter((e) => e.type === "message")).toHaveLength(1);
});
