import { afterEach, beforeEach, expect, it } from "vitest";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import type { ChatResponse, OpenAiCompatibleClient } from "@/assistant/llm/client";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type { ResultEnvelope, SourceInfo, TrainSearchProvider } from "@/providers/types";

/**
 * PROMPT 35 — full-results & voice/chat train-selection consistency.
 * The UI cards render the FULL provider list, so SELECT_TRAIN must validate
 * against that same complete authoritative set (any position), while the
 * LLM's rendered conversational context stays capped at 8 summaries.
 * Deterministic doubles only: scripted LLM (test double) + fixture provider.
 */

const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: `docs/provider-terms.md#${id}`,
  authorization: "configured",
});

const ROW_COUNT = 120; // realistic fixture >100 rows
const rowAt = (i: number) => ({
  trainNumber: String(90001 + i),
  trainName: `Full List Express ${i + 1}`,
  from: { code: "LDH", name: "Ludhiana" },
  to: { code: "NDLS", name: "Delhi" },
  departure: "06:15",
  arrival: "10:30",
  classes: ["CC", "EC"],
});

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
      const to = (q as { to?: string }).to ?? "NDLS";
      const rows =
        date === "2026-10-13"
          ? [{ ...rowAt(0), trainNumber: "91001", trainName: "Next Day Express" }]
          : to === "ASR"
            ? [{ ...rowAt(0), trainNumber: "92001", trainName: "Amritsar Mail", to: { code: "ASR", name: "Amritsar" } }]
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

async function searchTurn(store: ConversationStore, cid: string, date = "2026-10-12", to = "NDLS") {
  return drain(
    runTurn({
      conversationId: cid,
      message: "trains dikhao",
      store,
      clientFactory: oneClient([tools("s1", "SEARCH_TRAINS", { from: "LDH", to, date }), text("Ye trains hain.")]),
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

/* ---------- position coverage: first 8, 25, 40, 100+ ---------- */

it("a train among the first 8 results can be selected (positions 3 and 8)", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-1");
  expect(toolResultOf(await selectTurn(store, "fr-1", "90003")).status).toBe("ok");
  expect(store.get("fr-1")?.selection?.trainNumber).toBe("90003");
  expect(toolResultOf(await selectTurn(store, "fr-1", "90008")).status).toBe("ok");
  expect(store.get("fr-1")?.selection?.trainNumber).toBe("90008");
});

it("a valid train at position 25 is selectable (the live 12030 case)", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-2");
  const ev = await selectTurn(store, "fr-2", "90025");
  expect(toolResultOf(ev).status).toBe("ok");
  const form = ev.find((e) => e.type === "passenger_form") as Extract<TurnEvent, { type: "passenger_form" }>;
  expect(form.selection?.trainNumber).toBe("90025");
  expect(form.selection?.classes).toContain("CC");
  expect(store.get("fr-2")?.selection?.trainNumber).toBe("90025");
});

it("a valid train at position 40 is selectable", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-3");
  expect(toolResultOf(await selectTurn(store, "fr-3", "90040")).status).toBe("ok");
  expect(store.get("fr-3")?.selection?.trainNumber).toBe("90040");
});

it("valid trains at position 100 and beyond are selectable", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-4");
  expect(toolResultOf(await selectTurn(store, "fr-4", "90100")).status).toBe("ok"); // position 100
  expect(toolResultOf(await selectTurn(store, "fr-4", "90120")).status).toBe("ok"); // last row
  expect(store.get("fr-4")?.selection?.trainNumber).toBe("90120");
});

/* ---------- same authoritative set: cards <-> selection ---------- */

it("UI cards and chat selection validate against the same current result set (card at position 25)", async () => {
  const store = new ConversationStore();
  const ev = await searchTurn(store, "fr-5");
  const message = ev.find((e) => e.type === "message") as Extract<TurnEvent, { type: "message" }>;
  expect(message.cards).toHaveLength(ROW_COUNT); // cards render the FULL provider list
  // Tapping the card at position 25 sends exactly that card's train number:
  const tapped = message.cards![24].trainNumber!;
  expect(tapped).toBe("90025");
  expect(toolResultOf(await selectTurn(store, "fr-5", tapped)).status).toBe("ok");
  expect(store.get("fr-5")?.selection?.trainNumber).toBe("90025");
});

/* ---------- identity safety: absent / ambiguous / contract boundary ---------- */

it("a train absent from the current full results is rejected; nothing selected", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-6");
  expect(toolResultOf(await selectTurn(store, "fr-6", "99999")).status).toBe("error");
  expect(store.get("fr-6")?.selection).toBeUndefined();
});

it("ambiguous identity: a numeric PREFIX never silently selects a longer number", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-7");
  // "9000" is a 4-digit prefix of 90001…90009 — it must NOT select any of them.
  const ev = await selectTurn(store, "fr-7", "9000");
  expect(toolResultOf(ev).status).toBe("error");
  expect(store.get("fr-7")?.selection).toBeUndefined();
});

it("name-as-trainNumber is rejected by the existing contract — no silent wrong selection (documented boundary)", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-8");
  // The SELECT_TRAIN contract accepts only a 4–6 digit number. If the LLM
  // (wrongly) forwards a NAME, the schema rejects it and nothing is selected —
  // the assistant then asks the user for the number instead of guessing.
  const ev = await selectTurn(store, "fr-8", "Full List Express 25");
  const tr = toolResultOf(ev);
  expect(tr.status).toBe("invalid_arguments"); // existing schema contract rejects non-numbers
  expect(store.get("fr-8")?.selection).toBeUndefined();
});

/* ---------- staleness: superseded / route / session ---------- */

it("a train present only in a superseded search (date change) is rejected", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-9", "2026-10-12");
  await searchTurn(store, "fr-9", "2026-10-13"); // date change supersedes the 120-row search
  const conv = store.get("fr-9")!;
  expect(conv.results[0].supersededBy).toBeDefined();
  expect(toolResultOf(await selectTurn(store, "fr-9", "90025")).status).toBe("error");
  expect(store.get("fr-9")?.selection).toBeUndefined();
});

it("a train present only under a superseded route is rejected", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-10", "2026-10-12", "NDLS");
  await searchTurn(store, "fr-10", "2026-10-12", "ASR"); // route change supersedes
  const conv = store.get("fr-10")!;
  expect(conv.results[0].supersededBy).toBeDefined();
  expect(toolResultOf(await selectTurn(store, "fr-10", "90025")).status).toBe("error");
  expect(toolResultOf(await selectTurn(store, "fr-10", "92001")).status).toBe("ok"); // current route's train works
  expect(store.get("fr-10")?.selection?.trainNumber).toBe("92001");
});

it("SELECT_TRAIN without any search in the session is rejected (session mismatch)", async () => {
  const store = new ConversationStore();
  const ev = await selectTurn(store, "fr-11", "90025");
  expect(toolResultOf(ev).status).toBe("error");
  expect(store.get("fr-11")?.selection).toBeUndefined();
});

/* ---------- context cap & non-mutation ---------- */

it("the LLM's rendered conversational context stays capped at 8 summaries", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-12");
  const block = store.buildContextBlock(store.get("fr-12")!, "tNext", "2026-10-10");
  expect(block).toContain("8) 90008 "); // 8th summary rendered
  expect(block).not.toContain("90009 "); // 9th NOT rendered
  expect(block).toContain(`(+${ROW_COUNT - 8} more in current results`); // honest marker
});

it("building the compact LLM context never mutates or truncates the authoritative list", async () => {
  const store = new ConversationStore();
  await searchTurn(store, "fr-13");
  const conv = store.get("fr-13")!;
  const before = conv.results[0].items!.length;
  store.buildContextBlock(conv, "tNext", "2026-10-10"); // compaction for the LLM…
  store.buildContextBlock(conv, "tNext2", "2026-10-10");
  expect(store.get("fr-13")!.results[0].items).toHaveLength(before); // …does not shrink the store
  expect(store.get("fr-13")!.results[0].items).toHaveLength(ROW_COUNT);
  // and the beyond-8 train is still selectable AFTER repeated compaction
  expect(toolResultOf(await selectTurn(store, "fr-13", "90120")).status).toBe("ok");
});
