import { afterEach, beforeEach, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import type { ChatResponse, OpenAiCompatibleClient } from "@/assistant/llm/client";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type { ResultEnvelope, SourceInfo, TrainSearchProvider } from "@/providers/types";

/**
 * Train-list / SELECT_TRAIN consistency (verified mismatch fix): the UI cards
 * render the FULL provider list, so selection must validate against that same
 * full authoritative set — not the 8-item conversational rendering. The LLM's
 * rendered context stays capped at 8. Deterministic doubles only.
 */

const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: `docs/provider-terms.md#${id}`,
  authorization: "configured",
});

/** 30 rows for 2026-10-12 (12030-at-#25 style case); 1 different row next day. */
function fixtureAdapter(): TrainSearchProvider {
  return {
    id: "sfr-search",
    capabilities: ["trainSearch"],
    termsRef: "docs/provider-terms.md#sfr-search",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async search(q, ctx): Promise<ResultEnvelope<never>> {
      const date = (q as { date?: string }).date;
      const rows =
        date === "2026-10-13"
          ? [
              {
                trainNumber: "91001",
                trainName: "Next Day Express",
                from: { code: "LDH", name: "Ludhiana" },
                to: { code: "NDLS", name: "Delhi" },
                departure: "07:00",
                arrival: "11:00",
                classes: ["CC"],
              },
            ]
          : Array.from({ length: 30 }, (_, i) => ({
              trainNumber: String(90001 + i),
              trainName: `Full List Express ${i + 1}`,
              from: { code: "LDH", name: "Ludhiana" },
              to: { code: "NDLS", name: "Delhi" },
              departure: "06:15",
              arrival: "10:30",
              classes: ["CC", "EC"],
            }));
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

async function searchTurn(store: ConversationStore, cid: string, date: string) {
  return drain(
    runTurn({
      conversationId: cid,
      message: "trains dikhao",
      store,
      clientFactory: oneClient([
        tools("s1", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date }),
        text("Ye trains hain."),
      ]),
    }),
  );
}

async function selectTurn(store: ConversationStore, cid: string, trainNumber: string) {
  return drain(
    runTurn({
      conversationId: cid,
      message: `${trainNumber} select karo`,
      store,
      clientFactory: oneClient([tools("t1", "SELECT_TRAIN", { trainNumber }), text("ok")]),
    }),
  );
}

const toolResultOf = (ev: TurnEvent[]) =>
  ev.find((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>;

it("a train within the first 8 results can still be selected", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-1", "2026-10-12");
  const ev = await selectTurn(store, "fr-1", "90003");
  expect(toolResultOf(ev).status).toBe("ok");
  expect(store.get("fr-1")?.selection?.trainNumber).toBe("90003");
});

it("a train beyond the first 8 results (position 25) is selectable", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-2", "2026-10-12");
  const ev = await selectTurn(store, "fr-2", "90025");
  const tr = toolResultOf(ev);
  expect(tr.status).toBe("ok");
  const form = ev.find((e) => e.type === "passenger_form") as Extract<TurnEvent, { type: "passenger_form" }>;
  expect(form.selection?.trainNumber).toBe("90025");
  expect(form.selection?.classes).toContain("CC");
  expect(store.get("fr-2")?.selection?.trainNumber).toBe("90025");
});

it("a train absent from the current full results is rejected; nothing selected", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-3", "2026-10-12");
  const ev = await selectTurn(store, "fr-3", "99999");
  expect(toolResultOf(ev).status).toBe("error");
  expect(store.get("fr-3")?.selection).toBeUndefined();
});

it("a train only present in a superseded search is rejected", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-4", "2026-10-12");
  await searchTurn(store, "fr-4", "2026-10-13"); // date change supersedes the 30-row search
  const conv = store.get("fr-4")!;
  expect(conv.results[0].supersededBy).toBeDefined();
  const ev = await selectTurn(store, "fr-4", "90025"); // exists ONLY in the superseded ref
  expect(toolResultOf(ev).status).toBe("error");
  expect(store.get("fr-4")?.selection).toBeUndefined();
});

it("the LLM's rendered conversational context stays capped at 8 items", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-5", "2026-10-12");
  const block = store.buildContextBlock(store.get("fr-5")!, "tNext", "2026-10-10");
  expect(block).toContain("8) 90008 "); // 8th item rendered
  expect(block).not.toContain("90009 "); // 9th NOT rendered
  expect(block).toContain("(+22 more in current results"); // honest truncation marker
  // but the validation set itself is complete
  expect(store.get("fr-5")!.results[0].items).toHaveLength(30);
});

it("UI cards and chat/tool selection use the same current authoritative result set", async () => {
  const store = new ConversationStore();
  const ev = await searchTurn(store, "fr-6", "2026-10-12");
  const message = ev.find((e) => e.type === "message") as Extract<TurnEvent, { type: "message" }>;
  expect(message.cards).toHaveLength(30); // cards render the FULL provider list
  const sel = await selectTurn(store, "fr-6", "90025");
  expect(toolResultOf(sel).status).toBe("ok");
  expect(message.cards![24].trainNumber).toBe("90025"); // same row the user saw
  expect(store.get("fr-6")?.selection?.trainNumber).toBe("90025");
});
