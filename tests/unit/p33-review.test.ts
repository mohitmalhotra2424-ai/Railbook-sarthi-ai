/**
 * PROMPT 33 — review-page snapshot endpoint: provider fare/availability are
 * carried through from real tool results only; absent data stays absent
 * (never invented). Deterministic test doubles, no live calls.
 */
import { expect, it } from "vitest";
import { ConversationStore, conversationStore } from "@/assistant/context/store";
import { GET } from "@/app/api/passenger/route";

const SEL = {
  trainNumber: "12951",
  trainName: "Morning Express",
  from: "LDH",
  to: "NDLS",
  journeyDate: "2026-10-12",
  classes: ["SL", "3A", "2A"],
  classCode: "3A",
  selectedAt: "2026-10-11T00:00:00.000Z",
};

function mkResult(tool: string, data: unknown, over: Record<string, unknown> = {}) {
  return {
    tool,
    correlationId: `c-${Math.random()}`,
    status: "ok",
    note: "fixture",
    retrievedAt: "2026-10-12T05:00:00.000Z",
    data,
    ...over,
  } as never;
}

it("GET returns provider fare/availability captured from ok tool results", async () => {
  const id = "p33-get-snap-1";
  conversationStore.setSelection(id, SEL);
  conversationStore.beginTurn(id, "t1", "fare?");
  conversationStore.recordToolResult(
    id,
    "t1",
    "GET_FARE",
    { trainNumber: "12951", classCode: "3A", from: "LDH", to: "NDLS" },
    mkResult("GET_FARE", { trainNumber: "12951", classCode: "3A", from: { code: "LDH", name: "Ludhiana" }, to: { code: "NDLS", name: "New Delhi" }, baseFare: 500, totalFare: 545, currency: "INR" }),
  );
  conversationStore.beginTurn(id, "t2", "availability?");
  conversationStore.recordToolResult(
    id,
    "t2",
    "CHECK_AVAILABILITY",
    { trainNumber: "12951", classCode: "3A" },
    mkResult("CHECK_AVAILABILITY", { trainNumber: "12951", classes: [{ classCode: "3A", status: "RLWL2/WL2" }] }),
  );

  const res = await GET(new Request(`http://local/api/passenger?conversationId=${id}`));
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    fare: { totalFare: number; classCode: string; freshness: string } | null;
    availability: { classes: { classCode: string; status: string }[]; freshness: string } | null;
    readiness: { ready: boolean };
  };
  expect(body.fare?.totalFare).toBe(545);
  expect(body.fare?.classCode).toBe("3A");
  expect(body.availability?.classes[0]?.status).toBe("RLWL2/WL2");
  expect(body.readiness.ready).toBe(false); // passengers still missing
});

it("GET never invents fare/availability when no provider result exists", async () => {
  const id = "p33-get-snap-2";
  conversationStore.setSelection(id, SEL);
  const res = await GET(new Request(`http://local/api/passenger?conversationId=${id}`));
  const body = (await res.json()) as { fare: unknown; availability: unknown };
  expect(body.fare).toBeNull();
  expect(body.availability).toBeNull();
});

it("stale fare is surfaced as stale, not as current", async () => {
  const store = new ConversationStore();
  store.setSelection("p33-stale-fare", SEL);
  store.beginTurn("p33-stale-fare", "t1", "fare?");
  store.recordToolResult(
    "p33-stale-fare",
    "t1",
    "GET_FARE",
    { trainNumber: "12951", classCode: "3A" },
    mkResult("GET_FARE", { trainNumber: "12951", classCode: "3A", baseFare: 500, totalFare: 545, currency: "INR" }, { freshness: "stale" }),
  );
  const ref = store.get("p33-stale-fare")!.results.at(-1)!;
  expect(ref.fare?.totalFare).toBe(545);
  expect(ref.freshness).toBe("stale"); // UI must label it stale, never current
});
