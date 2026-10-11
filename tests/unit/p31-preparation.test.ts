/**
 * PROMPT 31 — BookingPreparationService, review/confirmation boundary and the
 * owner rule "every passenger-form field is mandatory before review".
 * All deterministic/mock-based: no provider or LLM calls. Live-provider
 * behaviour is covered separately (scripts/live-*.mjs, env-gated).
 */
import { describe, expect, it } from "vitest";
import {
  ConversationStore,
  REQUIRED_PASSENGER_FIELDS,
  type SelectionState,
} from "@/assistant/context/store";
import { evaluateReadiness, IRCTC_HANDOFF_READY } from "@/assistant/booking/preparation";
import { POST } from "@/app/api/passenger/route";
import { conversationStore } from "@/assistant/context/store";

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

function seedComplete(id: string): ConversationStore {
  const store = new ConversationStore();
  seedCompleteInto(store, id);
  return store;
}

describe("P31 readiness evaluation", () => {
  it("1. complete journey + complete passenger → ready, no blockers", () => {
    const store = seedComplete("p31-ready");
    const r = evaluateReadiness(store.get("p31-ready")!);
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.missingFields).toEqual([]);
  });

  it("2. no train / no class / no passengers → blockers + missing fields", () => {
    const store = new ConversationStore();
    const r0 = evaluateReadiness(store.getOrCreate("p31-empty"));
    expect(r0.ready).toBe(false);
    expect(r0.blockers.map((b) => b.code)).toContain("NO_TRAIN_SELECTED");
    expect(r0.blockers.map((b) => b.code)).toContain("NO_PASSENGERS");

    const store2 = new ConversationStore();
    store2.setSelection("p31-noclass", { ...SEL, classCode: undefined });
    const r1 = evaluateReadiness(store2.get("p31-noclass")!);
    expect(r1.blockers.map((b) => b.code)).toContain("NO_CLASS_SELECTED");
    expect(r1.missingFields).toContain("class");
  });

  it("3. class is validated against provider-returned classes (no invented classes)", () => {
    const store = new ConversationStore();
    store.setSelection("p31-badclass", { ...SEL, classCode: "1A" }); // 1A not in classes
    const r = evaluateReadiness(store.get("p31-badclass")!);
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain("CLASS_NOT_OFFERED");
  });

  it("4. owner rule: berth missing blocks review like any other field", () => {
    const store = new ConversationStore();
    store.setSelection("p31-berth", SEL);
    expect(store.updatePassenger("p31-berth", 1, { name: "Rahul Sharma", age: 28, gender: "male" }).ok).toBe(true);
    const r = evaluateReadiness(store.get("p31-berth")!);
    expect(r.ready).toBe(false);
    expect(r.missingFields).toContain("passenger 1: berth");
    expect(r.blockers.map((b) => b.code)).toContain("PASSENGER_INCOMPLETE");
    expect(REQUIRED_PASSENGER_FIELDS).toContain("berth");
  });

  it("5. invalid passenger data never reaches authoritative state", async () => {
    const id = "p31-invalid";
    const res = await POST(
      new Request("http://local/api/passenger", {
        method: "POST",
        body: JSON.stringify({ conversationId: id, field: "age", value: "280" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(conversationStore.get(id)?.passengers[0]?.age).toBeUndefined();
  });

  it("6. stale availability / fare for the selection blocks review; absence only warns", () => {
    const store = seedComplete("p31-stale");
    store.beginTurn("p31-stale", "t1", "availability?");
    store.recordToolResult("p31-stale", "t1", "CHECK_AVAILABILITY", { trainNumber: "12951", classCode: "3A" }, mkResult("CHECK_AVAILABILITY", { freshness: "stale" }));
    const r = evaluateReadiness(store.get("p31-stale")!);
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.code)).toContain("STALE_AVAILABILITY");

    const fresh = seedComplete("p31-fresh");
    fresh.beginTurn("p31-fresh", "t1", "availability?");
    fresh.recordToolResult("p31-fresh", "t1", "CHECK_AVAILABILITY", { trainNumber: "12951", classCode: "3A" }, mkResult("CHECK_AVAILABILITY", { freshness: "fresh" }));
    const rf = evaluateReadiness(fresh.get("p31-fresh")!);
    expect(rf.blockers.map((b) => b.code)).not.toContain("STALE_AVAILABILITY");
    expect(rf.warnings.map((w) => w.code)).toContain("FARE_NOT_VERIFIED"); // fare never checked → warning only

    const noAvail = seedComplete("p31-noavail");
    const rn = evaluateReadiness(noAvail.get("p31-noavail")!);
    expect(rn.ready).toBe(true); // absence is a warning, not a blocker
    expect(rn.warnings.map((w) => w.code)).toContain("AVAILABILITY_NOT_VERIFIED");
  });
});

describe("P31 review build + confirmation boundary", () => {
  it("7. review cannot be built while not ready; ready → awaiting_confirmation", () => {
    const store = new ConversationStore();
    store.setSelection("p31-r1", SEL);
    const blocked = store.buildReview("p31-r1");
    expect(blocked.ok).toBe(false);

    seedCompleteInto(store, "p31-r1b");
    const ok = store.buildReview("p31-r1b");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.review.status).toBe("awaiting_confirmation");
  });

  it("8. confirmation rejected outside awaiting state and for unknown conversations", () => {
    const store = new ConversationStore();
    expect(store.confirmReview("p31-never").ok).toBe(false); // no review at all
    seedCompleteInto(store, "p31-c1");
    const built = store.buildReview("p31-c1");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(store.confirmReview("p31-c1").ok).toBe(true);
    // second confirm: already confirmed, not awaiting
    const again = store.confirmReview("p31-c1");
    expect(again.ok).toBe(false);
  });

  it("9. any booking-critical change invalidates the review (passenger, class, journey)", () => {
    const store = new ConversationStore();
    seedCompleteInto(store, "p31-i1");
    // the selection was made against a recorded search for 2026-10-12
    store.beginTurn("p31-i1", "t0", "trains");
    store.recordToolResult(
      "p31-i1",
      "t0",
      "SEARCH_TRAINS",
      { from: "LDH", to: "NDLS", date: "2026-10-12" },
      mkResult("SEARCH_TRAINS", { journeyDate: "2026-10-12", data: [] }),
    );
    expect(store.buildReview("p31-i1").ok).toBe(true);
    expect(store.updatePassenger("p31-i1", 1, { age: 29 }).ok).toBe(true);
    expect(store.get("p31-i1")?.review).toBeUndefined();
    expect(store.confirmReview("p31-i1").ok).toBe(false);

    expect(store.buildReview("p31-i1").ok).toBe(true);
    store.setSelectionClass("p31-i1", "2A");
    expect(store.get("p31-i1")?.review).toBeUndefined();

    expect(store.buildReview("p31-i1").ok).toBe(true);
    // a new search for a different date supersedes + clears selection and review
    store.beginTurn("p31-i1", "t9", "kal ke trains");
    store.recordToolResult(
      "p31-i1",
      "t9",
      "SEARCH_TRAINS",
      { from: "LDH", to: "NDLS", date: "2026-10-13" },
      mkResult("SEARCH_TRAINS", { journeyDate: "2026-10-13", data: [] }),
    );
    expect(store.get("p31-i1")?.review).toBeUndefined();
    expect(store.get("p31-i1")?.selection).toBeUndefined();
  });

  it("10. fresh availability re-check after review invalidates the stale-able review", () => {
    const store = new ConversationStore();
    seedCompleteInto(store, "p31-i2");
    expect(store.buildReview("p31-i2").ok).toBe(true);
    store.beginTurn("p31-i2", "t2", "phir se check karo");
    store.recordToolResult("p31-i2", "t2", "CHECK_AVAILABILITY", { trainNumber: "12951", classCode: "3A" }, mkResult("CHECK_AVAILABILITY", { freshness: "fresh" }));
    expect(store.get("p31-i2")?.review).toBeUndefined();
  });

  it("11. confirmed review is the IRCTC_HANDOFF_READY preparation state (no booking)", () => {
    const store = new ConversationStore();
    seedCompleteInto(store, "p31-h1");
    expect(store.buildReview("p31-h1").ok).toBe(true);
    const conf = store.confirmReview("p31-h1");
    expect(conf.ok).toBe(true);
    if (conf.ok) expect(conf.review.status).toBe("confirmed");
    expect(IRCTC_HANDOFF_READY).toBe("IRCTC_HANDOFF_READY");
    // the store exposes no booking/payment capability whatsoever
    expect((store as unknown as Record<string, unknown>).book).toBeUndefined();
    expect((store as unknown as Record<string, unknown>).pay).toBeUndefined();
    expect((store as unknown as Record<string, unknown>).submitTicket).toBeUndefined();
  });

  it("12. /api/passenger review+confirm actions enforce the same boundary", async () => {
    const id = "p31-route-1";
    // unknown conversation → not ready, no review
    const r0 = await POST(
      new Request("http://local/api/passenger", { method: "POST", body: JSON.stringify({ conversationId: id, action: "review" }) }),
    );
    expect(r0.status).toBe(400);

    conversationStore.setSelection(id, SEL);
    for (const patch of [
      { name: "Rahul Sharma" },
      { age: 28 },
      { gender: "male" },
      { berth: "lower" },
    ] as const) {
      const r = await POST(
        new Request("http://local/api/passenger", { method: "POST", body: JSON.stringify({ conversationId: id, passengerIndex: 1, field: Object.keys(patch)[0], value: Object.values(patch)[0] }) }),
      );
      expect(r.status).toBe(200);
    }
    const rv = await POST(
      new Request("http://local/api/passenger", { method: "POST", body: JSON.stringify({ conversationId: id, action: "review" }) }),
    );
    expect(rv.status).toBe(200);
    const rvBody = (await rv.json()) as { review?: { status: string } };
    expect(rvBody.review?.status).toBe("awaiting_confirmation");

    const cf = await POST(
      new Request("http://local/api/passenger", { method: "POST", body: JSON.stringify({ conversationId: id, action: "confirm" }) }),
    );
    expect(cf.status).toBe(200);
    const cfBody = (await cf.json()) as { review?: { status: string }; handoff?: string };
    expect(cfBody.review?.status).toBe("confirmed");
    expect(cfBody.handoff).toBe(IRCTC_HANDOFF_READY);

    // passenger edit after confirmation invalidates; confirm now rejected
    const ed = await POST(
      new Request("http://local/api/passenger", { method: "POST", body: JSON.stringify({ conversationId: id, passengerIndex: 1, field: "berth", value: "upper" }) }),
    );
    expect(ed.status).toBe(200);
    const cf2 = await POST(
      new Request("http://local/api/passenger", { method: "POST", body: JSON.stringify({ conversationId: id, action: "confirm" }) }),
    );
    expect(cf2.status).toBe(400);
  });
});

function seedCompleteInto(store: ConversationStore, id: string) {
  store.setSelection(id, SEL);
  expect(store.updatePassenger(id, 1, { name: "Rahul Sharma", age: 28, gender: "male", berth: "lower" }).ok).toBe(true);
}
