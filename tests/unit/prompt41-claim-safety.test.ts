import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { guardAvailabilityClaims, type AvailabilityClaimGuardInput } from "@/assistant/availability-claim-guard";
import { runTurn, type TurnEvent } from "@/assistant/orchestrator";
import { ConversationStore } from "@/assistant/context/store";
import type { ChatResponse, OpenAiCompatibleClient } from "@/assistant/llm/client";
import { executeTool } from "@/assistant/tools/executor";
import { okEnvelope } from "@/providers/envelope";
import { registerAdapter, unregisterAdapter } from "@/providers/registry";
import type { ResultEnvelope, SourceInfo, TrainSearchProvider } from "@/providers/types";
import type { ToolResult } from "@/assistant/tools/results";

/**
 * PROMPT 41 — degraded-mode claim safety & result/response consistency.
 * The assistant may only claim confirmed/available/filtered when THIS turn's
 * structured tool outcomes support that exact claim. Deterministic mock
 * outcomes; mocks never prove production behaviour.
 */

const fr = (over: Partial<ToolResult> = {}): ToolResult => ({
  tool: "FILTER_TRAINS",
  correlationId: "c:f",
  status: "ok",
  note: "n",
  ...over,
});
const filterOk = (o: { classCode: string; checked: number; available: number; unavailable: number; unknown: number }): ToolResult =>
  fr({ classCode: o.classCode, availabilityFilter: { ...o, complete: o.unknown === 0 } });
const filterErr = (): ToolResult => fr({ status: "error", note: "no search results" });
const searchOk = (): ToolResult => ({ tool: "SEARCH_TRAINS", correlationId: "c:s", status: "ok", note: "n" });

describe("guardAvailabilityClaims — pure verdicts from structured outcomes", () => {
  it("1. failed filter + raw fallback search: a 'seats confirmed' heading is blocked and replaced with an honest disclosure", () => {
    const input: AvailabilityClaimGuardInput = {
      text: "**15 Oct 2026 – Ludhiana → Delhi (3A seats confirmed)**\nYe rahi 30 trains.",
      turnResults: [filterErr(), searchOk()],
    };
    const res = guardAvailabilityClaims(input);
    expect(res.adjusted).toBe(true);
    expect(res.blockedClaims[0].reason).toBe("filter_failed_raw_results");
    expect(res.text).not.toMatch(/seats confirmed/i);
    expect(res.text).toMatch(/complete nahi ho paaya|did not complete/i);
    expect(res.text).toMatch(/confirmed nahi|NOT confirmed/i);
    expect(res.text).toContain("Ye rahi 30 trains."); // raw list itself preserved
  });

  it("2. raw mixed statuses without any availability evidence: 'sabhi trains available' is blocked (EN + Hinglish + Hindi)", () => {
    const results = [searchOk()];
    for (const text of [
      "Sabhi trains mein seats available hain.",
      "All trains have seats available.",
      "सभी ट्रेनों में सीटें उपलब्ध हैं।",
    ]) {
      const res = guardAvailabilityClaims({ text, turnResults: results });
      expect(res.adjusted, text).toBe(true);
      expect(res.blockedClaims[0].reason).toBe("no_availability_evidence");
      expect(res.text).not.toMatch(/available hain|seats available|उपलब्ध हैं/i);
    }
  });

  it("3. complete successful filter: accurate confirmed wording passes untouched", () => {
    const results = [filterOk({ classCode: "3A", checked: 5, available: 5, unavailable: 0, unknown: 0 })];
    const res = guardAvailabilityClaims({
      text: "Ye 5 trains 3A mein confirmed hain. Sabhi trains ki seats confirmed hain.",
      turnResults: results,
    });
    expect(res.adjusted).toBe(false);
    expect(res.text).toContain("confirmed hain");
  });

  it("4. partial verification: subset wording passes, 'ALL trains' wording is corrected to describe partial coverage", () => {
    const results = [filterOk({ classCode: "3A", checked: 8, available: 2, unavailable: 3, unknown: 3 })];
    const okRes = guardAvailabilityClaims({ text: "In 2 trains mein 3A seats confirmed hain.", turnResults: results });
    expect(okRes.adjusted).toBe(false);
    const badRes = guardAvailabilityClaims({ text: "Sabhi trains ki seats confirmed hain.", turnResults: results });
    expect(badRes.adjusted).toBe(true);
    expect(badRes.blockedClaims[0].reason).toBe("incomplete_verification");
    expect(badRes.text).toMatch(/verify nahi ho paaye|could be verified/i);
  });

  it("5. all checks failed: 'koi train available nahi hai' is blocked; a COMPLETE verified negative passes", () => {
    const allFailed = [filterOk({ classCode: "3A", checked: 8, available: 0, unavailable: 0, unknown: 8 })];
    const res = guardAvailabilityClaims({ text: "Koi bhi train available nahi hai.", turnResults: allFailed });
    expect(res.adjusted).toBe(true);
    expect(res.blockedClaims[0].reason).toBe("unverified_no_availability_claim");
    expect(res.text).toMatch(/verify nahi ho paayi|could not be (fully )?verified/i);

    const completeNegative = [filterOk({ classCode: "3A", checked: 8, available: 0, unavailable: 8, unknown: 0 })];
    const ok = guardAvailabilityClaims({ text: "Koi bhi train available nahi hai — sab check ho gaye.", turnResults: completeNegative });
    expect(ok.adjusted).toBe(false);
  });

  it("6. evidence from earlier turns (stale/superseded) cannot justify a claim — only THIS turn's results count", () => {
    // The caller passes only the current turn's results; a stale ok filter
    // simply is not there, so the claim has no support.
    const res = guardAvailabilityClaims({
      text: "3A seats confirmed hain.",
      turnResults: [], // earlier-turn evidence deliberately absent
    });
    expect(res.adjusted).toBe(true);
    expect(res.blockedClaims[0].reason).toBe("no_availability_evidence");
  });

  it("7. class mismatch: 3A results never support an SL confirmation claim", () => {
    const results = [filterOk({ classCode: "3A", checked: 8, available: 4, unavailable: 4, unknown: 0 })];
    const res = guardAvailabilityClaims({ text: "SL mein bhi seats confirmed hain.", turnResults: results });
    expect(res.adjusted).toBe(true);
    expect(res.blockedClaims[0].reason).toBe("class_mismatch");
    expect(res.text).not.toMatch(/SL mein bhi seats confirmed/i);
  });

  it("a successful per-train CHECK_AVAILABILITY this turn supports a train-level claim; honest negations pass through", () => {
    const results: ToolResult[] = [
      { tool: "CHECK_AVAILABILITY", correlationId: "c", status: "ok", note: "n", classCode: "3A" },
    ];
    const ok = guardAvailabilityClaims({ text: "12926 mein 3A seats confirmed hain.", turnResults: results });
    expect(ok.adjusted).toBe(false);
    // Honest non-claims are never touched:
    const honest = guardAvailabilityClaims({
      text: "Seats confirmed nahi hain. 3A: WL 9. Availability verify nahi ho paayi.",
      turnResults: [filterErr(), searchOk()],
    });
    expect(honest.adjusted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Orchestration-level tests (scripted LLM; the guard runs inside runTurn)
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL",
  "LLM_FALLBACK_PROVIDER", "LLM_FALLBACK_MODEL", "LLM_FALLBACK_API_KEY", "LLM_FALLBACK_BASE_URL",
  "RAILWAY_PROVIDER_IDS", "RAILWAY_PROVIDER_P41_AVAIL_KEY",
];
beforeEach(() => {
  process.env.LLM_PROVIDER = "nvidia";
  process.env.LLM_MODEL = "meta/test-model";
  process.env.LLM_API_KEY = "nvapi-test";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
});
afterEach(() => {
  unregisterAdapter("p41-avail");
  for (const k of ENV_KEYS) delete process.env[k];
});

const chatResponse = (r: ChatResponse) => r;
const tools = (id: string, name: string, args: Record<string, unknown>): ChatResponse =>
  chatResponse({ content: null, toolCalls: [{ id, name, args }], model: "fake", finishReason: "tool_calls" });
const text = (t: string): ChatResponse => chatResponse({ content: t, toolCalls: [], model: "fake", finishReason: "stop" });

const oneClient = (script: ChatResponse[]) => {
  const c = scriptedClientInner(script);
  return () => c;
};
function scriptedClientInner(script: ChatResponse[]): OpenAiCompatibleClient {
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
async function drain(run: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of run) out.push(e);
  return out;
}
const messageOf = (ev: TurnEvent[]) => ev.find((e) => e.type === "message") as Extract<TurnEvent, { type: "message" }>;

it("8. P40 incident reproduced end-to-end: failed filter + fallback search ⇒ raw cards stay, heading becomes honest", async () => {
  const store = new ConversationStore();
  const ev = await drain(
    runTurn({
      conversationId: "p41-1",
      message: "sirf 3A confirmed trains",
      store,
      clientFactory: oneClient([
        tools("f1", "FILTER_TRAINS", { classCode: "3A", availableOnly: true }), // errors: no search ref
        tools("s1", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-15" }), // fallback raw search
        text("**Ludhiana → Delhi (3A seats confirmed)** Ye rahi trains, sabki seats confirmed hain."),
      ]),
    }),
  );
  const statuses = ev.filter((e) => e.type === "tool_result").map((e) => (e as { status: string }).status);
  expect(statuses).toEqual(["error", "not_configured"]); // no railway provider configured in this test env
  const msg = messageOf(ev);
  expect(msg).toBeDefined();
  // The unsupported heading and blanket claim are gone…
  expect(msg.text).not.toMatch(/3A seats confirmed/i);
  expect(msg.text).not.toMatch(/sabki seats confirmed hain/i);
  // …and an honest, structured-outcome-driven disclosure is present.
  expect(msg.text).toMatch(/complete nahi|did not complete|confirm nahi|no confirmed availability/i);
});

it("9. voice and text share one message event, so both channels carry the identical corrected claim", async () => {
  // Voice consumes the SAME message event text (single-channel contract in the
  // orchestrator); this asserts that contract holds for a corrected claim.
  const store = new ConversationStore();
  const ev = await drain(
    runTurn({
      conversationId: "p41-2",
      message: "confirmed trains?",
      store,
      clientFactory: oneClient([text("Sab trains mein 3A seats confirmed hain!")]),
    }),
  );
  const messages = ev.filter((e) => e.type === "message");
  expect(messages).toHaveLength(1); // exactly one event — text UI and TTS read the same string
  const msg = messageOf(ev);
  expect(msg.text).not.toMatch(/confirmed hain!/i);
  expect(msg.text).toMatch(/confirm|verified/i);
});

it("10. a FALLBACK model receives the same truthful outcome metadata and its false claim is corrected identically", async () => {
  process.env.LLM_FALLBACK_PROVIDER = "nvidia";
  process.env.LLM_FALLBACK_MODEL = "meta/fallback-model";
  process.env.LLM_FALLBACK_API_KEY = "nvapi-test";
  process.env.LLM_FALLBACK_BASE_URL = "https://llm.test/v1";
  const store = new ConversationStore();
  const ev = await drain(
    runTurn({
      conversationId: "p41-3",
      message: "confirmed trains?",
      store,
      clientFactory: (() => {
        const fb = scriptedClientInner([text("Sabhi trains ki seats confirmed hain.")]);
        return (cfg) => {
          if (cfg.model === "meta/fallback-model") return fb;
          return {
            config: cfg,
            async chat(): Promise<ChatResponse> {
              throw new Error("primary down");
            },
          } as unknown as OpenAiCompatibleClient;
        };
      })(),
    }),
  );
  const msg = messageOf(ev);
  expect(msg.viaFallback).toBe(true); // the fallback answered…
  expect(msg.text).not.toMatch(/Sabhi trains ki seats confirmed hain/i); // …and was guarded all the same
  expect(msg.text).toMatch(/no confirmed availability|verify|confirm nahi|unverified/i);
});

// ---------------------------------------------------------------------------
// Executor: structured availabilityFilter metadata (the guard's evidence)
// ---------------------------------------------------------------------------

const src = (id: string): SourceInfo => ({
  providerId: id,
  kind: "official-api",
  termsRef: `docs/provider-terms.md#${id}`,
  authorization: "configured",
});
const ROWS = Array.from({ length: 8 }, (_, i) => ({
  trainNumber: String(95001 + i),
  trainName: `Claim Test ${i + 1}`,
  from: { code: "LDH", name: "Ludhiana" },
  to: { code: "NDLS", name: "Delhi" },
  departure: "08:00",
  arrival: "12:00",
  classes: ["3A"],
}));
const OUTCOMES: Record<string, string> = {
  "95001": "AVL 5", "95002": "AVL 2", "95003": "WL 4",
  "95004": "ERR", "95005": "ERR", "95006": "ERR", "95007": "ERR", "95008": "ERR",
};

it("FILTER_TRAINS availableOnly returns structured availabilityFilter counts (guard evidence, prose-free)", async () => {
  process.env.RAILWAY_PROVIDER_IDS = "p41-avail";
  process.env.RAILWAY_PROVIDER_P41_AVAIL_KEY = "cred";
  const adapter: TrainSearchProvider & { availability: (q: unknown, ctx: { requestId: string }) => Promise<ResultEnvelope<never>> } = {
    id: "p41-avail",
    capabilities: ["trainSearch", "seatAvailability"],
    termsRef: "docs/provider-terms.md#p41-avail",
    async health() {
      return { ok: true, latencyMs: 1, errors: [] };
    },
    async search(_q, ctx) {
      return okEnvelope({ data: ROWS, source: src("p41-avail"), ttlSeconds: 300, requestId: ctx.requestId }) as ResultEnvelope<never>;
    },
    async availability(q, ctx) {
      const qq = q as { trainId: string };
      const outcome = OUTCOMES[qq.trainId] ?? "ERR";
      if (outcome === "ERR") {
        return {
          data: null,
          source: src("p41-avail"),
          retrievedAt: new Date().toISOString(),
          providerTimestamp: null,
          freshness: "fresh",
          errors: [{ code: "UPSTREAM_ERROR", message: "simulated", retryable: false }],
          confidence: "high",
        } as unknown as ResultEnvelope<never>;
      }
      return okEnvelope({
        data: { trainNumber: qq.trainId, date: "2026-10-12", from: { code: "LDH", name: "Ludhiana" }, to: { code: "NDLS", name: "Delhi" }, classes: [{ classCode: "3A", status: outcome, seatsText: outcome, asOf: null }] },
        source: src("p41-avail"),
        ttlSeconds: 300,
        requestId: ctx.requestId,
      }) as ResultEnvelope<never>;
    },
  };
  registerAdapter(adapter as unknown as TrainSearchProvider);
  const store = new ConversationStore();
  await drain(
    runTurn({
      conversationId: "p41-4",
      message: "trains",
      store,
      clientFactory: oneClient([tools("s1", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-12" }), text("ok")]),
    }),
  );
  const res = await executeTool("FILTER_TRAINS", { classCode: "3A", availableOnly: true }, undefined, {
    conversationId: "p41-4",
    turnId: "t",
    toolCallId: "c",
    store,
  });
  expect(res.status).toBe("ok");
  expect(res.availabilityFilter).toEqual({
    classCode: "3A",
    checked: 8,
    available: 2,
    unavailable: 1,
    unknown: 5,
    complete: false,
  });
  // Plain filters carry NO availability metadata (a filter is not a check):
  const plain = await executeTool("FILTER_TRAINS", { classCode: "3A" }, undefined, {
    conversationId: "p41-4",
    turnId: "t2",
    toolCallId: "c2",
    store,
  });
  expect(plain.status).toBe("ok");
  expect(plain.availabilityFilter).toBeUndefined();
});
