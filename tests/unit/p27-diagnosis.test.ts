import { afterEach, beforeEach, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import {
  LlmMalformedResponseError,
  LlmTimeoutError,
  OpenAiCompatibleClient,
  type ChatRequest,
  type ChatResponse,
} from "@/assistant/llm/client";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type { ResultEnvelope, SourceInfo, TrainSearchProvider } from "@/providers/types";

/**
 * PROMPT 27 — diagnosis harness for the residual L5/L6 tool-call omission.
 * All deterministic: scripted clients / mocked transport (clearly test
 * doubles). No live model calls here. Sanitized: no PII beyond synthetic
 * fixture values, no secrets.
 *
 * Stage coverage:
 *  - request: tools + tool_choice actually sent (stage "tool available")
 *  - context: form state + MISSING fields in the LLM context (stages 1/4)
 *  - response parsing: tool_calls parsed; empty-array edge documented (stage 8)
 *  - dispatch/validation/state (stages "validation", "dispatch", "state")
 *  - provider failure paths (stage 7)
 */

const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: "t",
  authorization: "configured",
});
function fixtureAdapter(): TrainSearchProvider {
  return {
    id: "d27-search",
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
        source: src("d27-search"),
        ttlSeconds: 300,
        requestId: ctx.requestId,
      }) as ResultEnvelope<never>;
    },
  };
}

/** Scripted client that RECORDS every request it receives. */
function recordingClient(script: ChatResponse[]): {
  factory: () => OpenAiCompatibleClient;
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  let n = 0;
  const stub = {
    config: { provider: "fake", model: "fake", apiKey: "x", baseUrl: "y", timeoutMs: 5000 },
    async chat(req: ChatRequest): Promise<ChatResponse> {
      // Snapshot: the orchestrator mutates messages[1] (context refresh) after
      // tool execution — diagnostics must capture the request AS SENT.
      requests.push(structuredClone(req));
      const r = script[Math.min(n, script.length - 1)];
      n += 1;
      return r;
    },
  };
  const c = stub as unknown as OpenAiCompatibleClient;
  return { factory: () => c, requests };
}

const tools = (id: string, name: string, args: Record<string, unknown>): ChatResponse => ({
  content: null,
  toolCalls: [{ id, name, args }],
  model: "fake",
  finishReason: "tool_calls",
});
const text = (t: string): ChatResponse => ({ content: t, toolCalls: [], model: "fake", finishReason: "stop" });

const LLM_ENV = ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL", "RAILWAY_PROVIDER_IDS", "RAILWAY_PROVIDER_D27_SEARCH_KEY"];
beforeEach(() => {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  process.env.RAILWAY_PROVIDER_IDS = "d27-search";
  process.env.RAILWAY_PROVIDER_D27_SEARCH_KEY = "cred";
  registerAdapter(fixtureAdapter());
});
afterEach(() => {
  unregisterAdapter("d27-search");
  for (const k of LLM_ENV) delete process.env[k];
});

async function drain(run: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of run) out.push(e);
  return out;
}

/** Search + select + class, then name saved — the exact live L5 setup. */
async function setupUntilNameSaved(store: ConversationStore, cid: string) {
  const s1 = recordingClient([
    tools("s1", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-12" }),
    text("Ye trains hain."),
  ]);
  await drain(runTurn({ conversationId: cid, message: "trains dikhao", store, clientFactory: s1.factory }));
  const s2 = recordingClient([
    tools("a", "SELECT_TRAIN", { trainNumber: "12951" }),
    tools("b", "SELECT_CLASS", { classCode: "3A" }),
    text("Train aur class select ho gayi. Passenger ka naam bataiye."),
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

/* ============ CASE A — answer to the current question ============ */

it("A: on the 'Age 28' turn the model DOES receive the tool + full passenger context; a compliant model dispatches the update", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "d27-a");

  const rec = recordingClient([
    tools("u", "UPDATE_PASSENGER", { field: "age", value: "28" }),
    text("Age 28 save ho gaya. Ab gender bataiye."),
  ]);
  const ev = await drain(
    runTurn({ conversationId: "d27-a", message: "Age 28.", store, clientFactory: rec.factory }),
  );

  // Stage "tool available": the request carried all 12 tools incl. UPDATE_PASSENGER.
  const req = rec.requests[0];
  expect(req?.tools?.map((t) => t.function.name)).toContain("UPDATE_PASSENGER");
  expect(req?.tools).toHaveLength(12);
  // Stage "context available": system context names the stored passenger and
  // the exact missing fields — nothing stale, nothing absent.
  const ctx = req?.messages[1]?.content ?? "";
  expect(ctx).toContain("name=Rahul Sharma");
  expect(ctx).toContain("MISSING: age,gender");
  expect(ctx).toContain("class=3A");
  // The user's answer is the final message (ordering intact).
  expect(req?.messages.at(-1)?.content).toBe("Age 28.");
  // A compliant model's tool call IS dispatched and reaches authoritative state.
  const tr = ev.filter((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>[];
  expect(tr.map((t) => `${t.tool}:${t.status}`)).toEqual(["UPDATE_PASSENGER:ok"]);
  expect(store.get("d27-a")?.passengers[0]).toMatchObject({ name: "Rahul Sharma", age: 28 });
  // Truthful confirmation passes the guard untouched.
  expect(messageText(ev)).toBe("Age 28 save ho gaya. Ab gender bataiye.");
});

/* ============ CASE B — explicit field instruction ============ */

it("B: 'Age 28 save kar do' → same tool requested and dispatched", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "d27-b");
  const ev = await drain(
    runTurn({
      conversationId: "d27-b",
      message: "Age 28 save kar do.",
      store,
      clientFactory: recordingClient([
        tools("u", "UPDATE_PASSENGER", { field: "age", value: "28" }),
        text("Ho gaya."),
      ]).factory,
    }),
  );
  const tr = ev.find((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>;
  expect(tr.status).toBe("ok");
  expect(store.get("d27-b")?.passengers[0]?.age).toBe(28);
});

/* ============ CASE C — context already supplied ============ */

it("C: with name already stored, the context marks it present — no re-ask needed; '28' alone maps to age via the model", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "d27-c");
  const rec = recordingClient([
    tools("u", "UPDATE_PASSENGER", { field: "age", value: "28" }),
    text("Age save ho gaya."),
  ]);
  await drain(runTurn({ conversationId: "d27-c", message: "28", store, clientFactory: rec.factory }));
  const ctx = rec.requests[0]?.messages[1]?.content ?? "";
  // Name is present (never listed as missing) → the model is never asked for it again.
  expect(ctx).toContain("name=Rahul Sharma");
  expect(ctx).not.toContain("MISSING: name");
  expect(ctx).toContain("MISSING: age,gender");
  // Bare "28" was recorded as age; name retained (no duplication/re-ask).
  expect(store.get("d27-c")?.passengers[0]).toMatchObject({ name: "Rahul Sharma", age: 28 });
});

/* ============ CASE D — invalid age ============ */

it("D: invalid age is rejected by existing validation; form unchanged", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "d27-d");
  const ev = await drain(
    runTurn({
      conversationId: "d27-d",
      message: "Age 280.",
      store,
      clientFactory: recordingClient([
        tools("u", "UPDATE_PASSENGER", { field: "age", value: "280" }),
        text("280 valid nahi hai — sahi age bataiye."),
      ]).factory,
    }),
  );
  const tr = ev.find((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>;
  expect(tr.status).toBe("invalid_arguments");
  expect(store.get("d27-d")?.passengers[0]).toEqual({ name: "Rahul Sharma" });
});

/* ============ CASE E — recorded sanitized live response, no tool call ============ */

it("E: recorded live failure shape (plain text, toolResults:0) → guard blocks the false claim", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "d27-e");
  // Verbatim shape observed live in P25/P26 (turn toolResults:0, finish stop):
  const ev = await drain(
    runTurn({
      conversationId: "d27-e",
      message: "Age 28.",
      store,
      clientFactory: recordingClient([text("Age 28 save ho gaya.\n\nAb gender batao — Male / Female / Trans.")]).factory,
    }),
  );
  expect(ev.filter((e) => e.type === "tool_result")).toHaveLength(0);
  expect(messageText(ev)).not.toMatch(/save ho gaya/i);
  expect(messageText(ev)).toMatch(/Age abhi save confirm nahi hui/);
  expect(store.get("d27-e")?.passengers[0]).toEqual({ name: "Rahul Sharma" });
});

/* ============ CASE F — genuine tool success ============ */

it("F: valid tool call dispatched, succeeds, updates the correct authoritative field", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "d27-f");
  await drain(
    runTurn({
      conversationId: "d27-f",
      message: "Age 28.",
      store,
      clientFactory: recordingClient([
        tools("u", "UPDATE_PASSENGER", { passenger: 1, field: "age", value: "28" }),
        text("saved"),
      ]).factory,
    }),
  );
  expect(store.get("d27-f")?.passengers[0]).toEqual({ name: "Rahul Sharma", age: 28 });
});

/* ============ CASE G — provider failure paths ============ */

it("G: timeout/error → honest error event, no form change, no save claim", async () => {
  const store = new ConversationStore();
  await setupUntilNameSaved(store, "d27-g");
  const failing = {
    config: { provider: "fake", model: "fake", apiKey: "x", baseUrl: "y", timeoutMs: 5000 },
    async chat(): Promise<ChatResponse> {
      throw new LlmTimeoutError("fake", 5000);
    },
  } as unknown as OpenAiCompatibleClient;
  const ev = await drain(
    runTurn({ conversationId: "d27-g", message: "Age 28.", store, clientFactory: () => failing }),
  );
  const err = ev.find((e) => e.type === "error") as Extract<TurnEvent, { type: "error" }>;
  expect(err.code).toBe("LLM_TIMEOUT");
  expect(ev.find((e) => e.type === "message")).toBeUndefined(); // nothing delivered
  expect(store.get("d27-g")?.passengers[0]).toEqual({ name: "Rahul Sharma" }); // unchanged
});

/* ====== request/response wire-level evidence (client, mocked transport) ====== */

const cfg = { provider: "p", model: "m", apiKey: "k", baseUrl: "https://x.test/v1", timeoutMs: 1000 };
const mockTransport = (payload: unknown, status = 200) => {
  const calls: { body: unknown }[] = [];
  const transport = (async (_url: unknown, init: { body: string }) => {
    calls.push({ body: JSON.parse(init.body) });
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers(),
      json: async () => payload,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { transport, calls };
};

it("wire: tools + tool_choice:auto are sent on the request body", async () => {
  const { transport, calls } = mockTransport({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }], model: "m" });
  const client = new OpenAiCompatibleClient(cfg, transport);
  await client.chat({
    messages: [{ role: "user", content: "Age 28." }],
    tools: [{ type: "function", function: { name: "UPDATE_PASSENGER", description: "d", parameters: {} } }],
  });
  const body = calls[0]?.body as { tools?: unknown[]; tool_choice?: string };
  expect(body.tools).toHaveLength(1);
  expect(body.tool_choice).toBe("auto"); // plain text is permitted by design
});

it("wire: standard tool_calls parse correctly", async () => {
  const { transport } = mockTransport({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [{ id: "c1", type: "function", function: { name: "UPDATE_PASSENGER", arguments: '{"field":"age","value":"28"}' } }],
        },
        finish_reason: "tool_calls",
      },
    ],
    model: "m",
  });
  const r = await new OpenAiCompatibleClient(cfg, transport).chat({ messages: [] });
  expect(r.toolCalls).toEqual([{ id: "c1", name: "UPDATE_PASSENGER", args: { field: "age", value: "28" } }]);
  expect(r.finishReason).toBe("tool_calls");
});

it("wire edge: finish_reason=tool_calls with an EMPTY tool_calls array degrades to a plain-text turn (stage-8 evidence)", async () => {
  const { transport } = mockTransport({
    choices: [{ message: { content: "Age 28 save ho gaya.", tool_calls: [] }, finish_reason: "tool_calls" }],
    model: "m",
  });
  const r = await new OpenAiCompatibleClient(cfg, transport).chat({ messages: [] });
  // No tool call survives; the orchestrator treats this as a direct answer.
  // (The P26 guard is what keeps such a turn honest.)
  expect(r.toolCalls).toHaveLength(0);
  expect(r.content).toBe("Age 28 save ho gaya.");
  expect(r.finishReason).toBe("tool_calls");
});

it("wire: malformed payload → LlmMalformedResponseError (never a silent success)", async () => {
  const { transport } = mockTransport({ nope: true });
  await expect(new OpenAiCompatibleClient(cfg, transport).chat({ messages: [] })).rejects.toBeInstanceOf(
    LlmMalformedResponseError,
  );
});
