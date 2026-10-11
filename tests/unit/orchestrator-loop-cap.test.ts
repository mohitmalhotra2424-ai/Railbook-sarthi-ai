import { afterEach, beforeEach, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import type { ChatResponse, OpenAiCompatibleClient } from "@/assistant/llm/client";

/**
 * PROMPT 15 §6 — an LLM that NEVER stops requesting tools must be capped
 * (no infinite loops), and the turn must end honestly instead of hanging.
 */
const LLM_ENV = ["LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL"];

beforeEach(() => {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
});
afterEach(() => {
  for (const k of LLM_ENV) delete process.env[k];
});

const greedy: ChatResponse = {
  content: null,
  toolCalls: [{ id: "g1", name: "SEARCH_TRAINS", args: { from: "LDH", to: "NDLS", date: "2026-10-12" } }],
  model: "fake-model",
  finishReason: "tool_calls",
};

it("caps tool iterations and ends the turn without hanging or fake cards", async () => {
  let calls = 0;
  const client = {
    config: { provider: "fake", model: "fake", apiKey: "x", baseUrl: "y", timeoutMs: 100 },
    async chat() {
      calls += 1;
      return greedy;
    },
  } as unknown as OpenAiCompatibleClient;

  const events: TurnEvent[] = [];
  const store = new ConversationStore();
  for await (const e of runTurn({
    conversationId: "cap-1",
    message: "trains batao",
    store,
    clientFactory: () => client,
  })) {
    events.push(e);
  }

  expect(calls).toBeGreaterThan(0);
  expect(calls).toBeLessThanOrEqual(7); // MAX_TOOL_ITERATIONS(6) + bounded exit
  const ended = events.some((e) => e.type === "error" || e.type === "message");
  expect(ended).toBe(true);
  const msg = events.find((e) => e.type === "message") as
    | Extract<TurnEvent, { type: "message" }>
    | undefined;
  if (msg) expect(msg.cards.length).toBe(0); // never invent trains to exit the loop
});
