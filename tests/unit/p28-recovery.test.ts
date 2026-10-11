import { afterEach, beforeEach, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import { LlmTimeoutError, type ChatRequest, type ChatResponse, type OpenAiCompatibleClient } from "@/assistant/llm/client";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type { ResultEnvelope, SourceInfo, TrainSearchProvider } from "@/providers/types";

/**
 * PROMPT 28 — bounded tool-call recovery (Tests A–K). All deterministic:
 * scripted/recording LLM doubles + fixture provider. No live calls here.
 */

const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: "t",
  authorization: "configured",
});
function fixtureAdapter(): TrainSearchProvider {
  return {
    id: "r28-search",
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
        source: src("r28-search"),
        ttlSeconds: 300,
        requestId: ctx.requestId,
      }) as ResultEnvelope<never>;
    },
  };
}

type Step = ChatResponse | (() => Promise<ChatResponse>);

/** Recording client: replays steps in order (last step repeats) and may throw. */
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

const LLM_ENV = ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL", "RAILWAY_PROVIDER_IDS", "RAILWAY_PROVIDER_R28_SEARCH_KEY"];
beforeEach(() => {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  process.env.RAILWAY_PROVIDER_IDS = "r28-search";
  process.env.RAILWAY_PROVIDER_R28_SEARCH_KEY = "cred";
  registerAdapter(fixtureAdapter());
});
afterEach(() => {
  unregisterAdapter("r28-search");
  for (const k of LLM_ENV) delete process.env[k];
});

async function drain(run: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of run) out.push(e);
  return out;
}

/** search → select train+class → name saved. Exactly the live L5 setup. */
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
const messageCount = (ev: TurnEvent[]): number => ev.filter((e) => e.type === "message").length;
const FALSE_CLAIM = "Age 28 save ho gaya.";

/* ===== A — normal conversation never triggers recovery ===== */

it("A: normal conversation does not trigger recovery (single request)", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "r28-a");
  const rec = recordingClient([text("12951 subah 06:15 par chalti hai. Age bataiye?")]);
  const ev = await drain(runTurn({ conversationId: "r28-a", message: "Train kab chalti hai?", store, clientFactory: rec.factory }));
  expect(rec.requests).toHaveLength(1); // no second request
  expect(messageText(ev)).toBe("12951 subah 06:15 par chalti hai. Age bataiye?");
});

/* ===== B — unsupported claim + missing field → exactly one extra request ===== */

it("B: unsupported save claim for a genuinely missing field triggers exactly ONE additional request", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "r28-b");
  const rec = recordingClient([
    text(`${FALSE_CLAIM}\n\nAb gender batao.`),                       // 1st: the live failure shape
    tools("u", "UPDATE_PASSENGER", { field: "age", value: "28" }),     // 2nd: recovery succeeds
    text("Age 28 form mein record ho gayi."),                          // 3rd: truthful wrap-up
  ]);
  const ev = await drain(runTurn({ conversationId: "r28-b", message: "Age 28.", store, clientFactory: rec.factory }));
  expect(rec.requests).toHaveLength(3); // original + ONE recovery + final answer (no 4th)
  // The recovery request carried the correction instruction.
  const recoveryMsgs = rec.requests[1]?.messages ?? [];
  expect(recoveryMsgs.at(-1)?.role).toBe("system");
  expect(recoveryMsgs.at(-1)?.content).toContain("RECOVERY");
  expect(recoveryMsgs.at(-2)?.content).toBe(FALSE_CLAIM + "\n\nAb gender batao."); // model sees its own claim
  expect(messageText(ev)).toBe("Age 28 form mein record ho gayi.");
});

/* ===== C — recovery tool call uses the existing pipeline ===== */

it("C: valid recovery tool call goes through existing validation/dispatch and saves truthfully", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "r28-c");
  const rec = recordingClient([
    text(FALSE_CLAIM),
    tools("u", "UPDATE_PASSENGER", { field: "age", value: "28" }),
    text("Age 28 save ho gaya."),
  ]);
  const ev = await drain(runTurn({ conversationId: "r28-c", message: "Age 28.", store, clientFactory: rec.factory }));
  const tr = ev.filter((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>[];
  expect(tr.map((t) => `${t.tool}:${t.status}`)).toEqual(["UPDATE_PASSENGER:ok"]);
  // Authoritative state updated; truthful confirmation delivered unmodified.
  expect(store.get("r28-c")?.passengers[0]).toMatchObject({ name: "Rahul Sharma", age: 28 });
  expect(messageText(ev)).toBe("Age 28 save ho gaya.");
  // The form UI event fired through the normal path.
  expect(ev.some((e) => e.type === "passenger_form")).toBe(true);
});

/* ===== D — invalid value cannot be saved via recovery ===== */

it("D: invalid passenger value in a recovery tool call is rejected; form unchanged", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "r28-d");
  const rec = recordingClient([
    text("Age 280 save ho gaya."),
    tools("u", "UPDATE_PASSENGER", { field: "age", value: "280" }),
    text("280 valid nahi hai — sahi age bataiye."),
  ]);
  const ev = await drain(runTurn({ conversationId: "r28-d", message: "Age 280.", store, clientFactory: rec.factory }));
  const tr = ev.find((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>;
  expect(tr.status).toBe("invalid_arguments");
  expect(store.get("r28-d")?.passengers[0]).toEqual({ name: "Rahul Sharma" }); // age NOT saved
});

/* ===== E — second plain text → honest fallback, no third request ===== */

it("E: recovery returning plain text again preserves the honest fallback (exactly 2 requests)", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "r28-e");
  const rec = recordingClient([text(FALSE_CLAIM)]); // same claim every time
  const ev = await drain(runTurn({ conversationId: "r28-e", message: "Age 28.", store, clientFactory: rec.factory }));
  expect(rec.requests).toHaveLength(2); // original + ONE recovery — never a third
  expect(messageText(ev)).not.toMatch(/save ho gaya/i);
  expect(messageText(ev)).toMatch(/Age abhi save confirm nahi hui/);
  expect(store.get("r28-e")?.passengers[0]).toEqual({ name: "Rahul Sharma" });
});

/* ===== F — recovery request failure cannot fabricate success ===== */

it("F: recovery timeout/error delivers the honest fallback — no false claim, no raw error", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "r28-f");
  const rec = recordingClient([
    text(FALSE_CLAIM),
    async () => {
      throw new LlmTimeoutError("fake", 5000);
    },
  ]);
  const ev = await drain(runTurn({ conversationId: "r28-f", message: "Age 28.", store, clientFactory: rec.factory }));
  expect(ev.find((e) => e.type === "error")).toBeUndefined(); // fallback, not error
  expect(messageText(ev)).not.toMatch(/save ho gaya/i);
  expect(messageText(ev)).toMatch(/Age abhi save confirm nahi hui/);
  expect(store.get("r28-f")?.passengers[0]).toEqual({ name: "Rahul Sharma" });
});

/* ===== G — already-saved field never triggers recovery ===== */

it("G: truthful confirmation of an already-saved value: guard allows, no recovery", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "r28-g");
  // Save age legitimately first.
  const s = recordingClient([tools("u", "UPDATE_PASSENGER", { field: "age", value: "28" }), text("Age save ho gaya.")]);
  await drain(runTurn({ conversationId: "r28-g", message: "Age 28.", store, clientFactory: s.factory }));
  // Later turn re-confirms from authoritative state without a tool call.
  const rec = recordingClient([text("Aapki age 28 save ho chuki hai.")]);
  const ev = await drain(runTurn({ conversationId: "r28-g", message: "Age save hai na?", store, clientFactory: rec.factory }));
  expect(rec.requests).toHaveLength(1); // no recovery for a supported claim
  expect(messageText(ev)).toBe("Aapki age 28 save ho chuki hai.");
});

/* ===== H — repeated guard evaluation cannot exceed one recovery ===== */

it("H: multiple blocked claims across recovery responses still total ONE recovery request", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "r28-h");
  const rec = recordingClient([
    text("Age 28 save ho gaya."),        // blocked (age missing) → recovery fires
    text("Age 28 save ho gaya, pakka."), // blocked AGAIN — but recovery is spent
  ]);
  const ev = await drain(runTurn({ conversationId: "r28-h", message: "Age 28.", store, clientFactory: rec.factory }));
  expect(rec.requests).toHaveLength(2); // guard fired repeatedly; recovery fired once
  expect(messageText(ev)).not.toMatch(/save ho gaya/i);
  expect(messageText(ev)).toMatch(/Age abhi save confirm nahi hui/);
});

/* ===== I — step limits + duplicate-execution protection intact ===== */

it("I: duplicate tool call during recovery is suppressed; tool-step cap still applies", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "r28-i");
  const rec = recordingClient([
    text(FALSE_CLAIM),
    tools("u1", "UPDATE_PASSENGER", { field: "age", value: "28" }),
    tools("u2", "UPDATE_PASSENGER", { field: "age", value: "28" }), // identical duplicate
    text("Age 28 save ho gaya."),
  ]);
  const ev = await drain(runTurn({ conversationId: "r28-i", message: "Age 28.", store, clientFactory: rec.factory }));
  const tr = ev.filter((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>[];
  // The duplicate was suppressed (fed back to the model as a tool message,
  // NOT executed): exactly one tool_result, saved once.
  expect(rec.requests).toHaveLength(4); // claim, u1, u2(duplicate), final text
  expect(tr.map((t) => t.status)).toEqual(["ok"]);
  expect(store.get("r28-i")?.passengers[0]?.age).toBe(28);
  expect(messageText(ev)).toBe("Age 28 save ho gaya."); // truthful — evidence exists
});

/* ===== J — text/voice parity, single message emission ===== */

it("J: recovery turn emits exactly ONE message event (shared by text and voice)", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "r28-j");
  const rec = recordingClient([
    text(FALSE_CLAIM),
    tools("u", "UPDATE_PASSENGER", { field: "age", value: "28" }),
    text("Age 28 save ho gaya."),
  ]);
  const ev = await drain(runTurn({ conversationId: "r28-j", message: "Age 28.", store, clientFactory: rec.factory }));
  expect(messageCount(ev)).toBe(1); // no duplicate bubbles/TTS
  expect(messageText(ev)).toBe("Age 28 save ho gaya."); // truthful after verified recovery
});

/* ===== K — unrelated flows unaffected ===== */

it("K: railway Q&A, corrections, and name handling behave exactly as before", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "r28-k");
  // Name correction (legitimate tool call, no recovery involved)
  const c1 = recordingClient([
    tools("x", "UPDATE_PASSENGER", { field: "name", value: "Rohit Sharma" }),
    text("Naam Rohit Sharma kar diya."),
  ]);
  const ev1 = await drain(runTurn({ conversationId: "r28-k", message: "Naam Rohit Sharma hai", store, clientFactory: c1.factory }));
  expect(c1.requests).toHaveLength(2); // tool turn + final answer, no recovery
  expect(store.get("r28-k")?.passengers[0]?.name).toBe("Rohit Sharma");
  expect(messageText(ev1)).toBe("Naam Rohit Sharma kar diya.");
  // Plain railway Q&A with selection present
  const c2 = recordingClient([text("12951 ke supported classes SL, 3A, 2A hain.")]);
  const ev2 = await drain(runTurn({ conversationId: "r28-k", message: "Kaunse class hain?", store, clientFactory: c2.factory }));
  expect(c2.requests).toHaveLength(1);
  expect(messageText(ev2)).toBe("12951 ke supported classes SL, 3A, 2A hain.");
});
