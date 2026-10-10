import { beforeEach, describe, expect, it } from "vitest";
import { ConversationStore } from "@/assistant/context/store";
import type { ToolResult } from "@/assistant/tools/results";

function toolResult(tool: string, over: Partial<ToolResult> = {}): ToolResult {
  return {
    tool,
    correlationId: `c:t:${tool}`,
    status: "ok",
    note: "n",
    ...over,
  };
}

let store: ConversationStore;
beforeEach(() => {
  store = new ConversationStore();
});

describe("conversation store", () => {
  it("begins turns and records user messages under a stable conversation id", () => {
    const conv = store.beginTurn("conv-1", "t1", "Ludhiana se Delhi trains");
    expect(conv.id).toBe("conv-1");
    expect(conv.currentTurnId).toBe("t1");
    expect(conv.messages.at(-1)).toMatchObject({ role: "user", content: "Ludhiana se Delhi trains" });
    // Same id returns the same conversation.
    const again = store.beginTurn("conv-1", "t2", "kal ke liye");
    expect(again.messages).toHaveLength(2);
  });

  it("records tool results as compact refs and updates journey context", () => {
    store.beginTurn("c", "t1", "search");
    const ref = store.recordToolResult(
      "c",
      "t1",
      "SEARCH_TRAINS",
      { from: "LDH", to: "NDLS", date: "2026-10-11" },
      toolResult("SEARCH_TRAINS", {
        journeyDate: "2026-10-11",
        data: [
          { trainNumber: "12951", trainName: "Mumbai Rajdhani", departure: "16:55", arrival: "08:35" },
          { trainNumber: "12013", trainName: "Shatabdi", departure: "06:40", arrival: "11:05" },
        ],
      }),
    );
    expect(ref?.refId).toBe("r1");
    expect(ref?.items).toHaveLength(2);
    expect(ref?.items?.[1].label).toContain("12013");
    const conv = store.get("c")!;
    expect(conv.journey).toMatchObject({ from: "LDH", to: "NDLS", date: "2026-10-11" });
  });

  it("invalidates older results when the journey date changes (supersede)", () => {
    store.beginTurn("c", "t1", "s1");
    store.recordToolResult("c", "t1", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-11" }, toolResult("SEARCH_TRAINS"));
    store.beginTurn("c", "t2", "kal nahi, parso");
    store.recordToolResult("c", "t2", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-12" }, toolResult("SEARCH_TRAINS"));

    const conv = store.get("c")!;
    expect(conv.results[0].supersededBy).toBe("r2");
    expect(conv.results[0].supersededReason).toContain("date");
    expect(conv.results[1].supersededBy).toBeUndefined();
    expect(store.buildContextBlock(conv, "t2", "2026-10-10")).toContain("SUPERSEDED by r2");
  });

  it("invalidates older results when the route changes", () => {
    store.beginTurn("c", "t1", "s1");
    store.recordToolResult("c", "t1", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-11" }, toolResult("SEARCH_TRAINS"));
    store.recordToolResult("c", "t1", "SEARCH_TRAINS", { from: "LDH", to: "ASR", date: "2026-10-11" }, toolResult("SEARCH_TRAINS"));
    const conv = store.get("c")!;
    expect(conv.results[0].supersededReason).toContain("route");
  });

  it("REFUSES stale-turn results overwriting a newer turn (interrupt protection)", () => {
    store.beginTurn("c", "t1", "first");
    store.beginTurn("c", "t2", "correction before t1 result lands");
    const rejected = store.recordToolResult(
      "c",
      "t1", // older turn finishing late
      "SEARCH_TRAINS",
      { from: "XXX", to: "YYY", date: "2020-01-01" },
      toolResult("SEARCH_TRAINS"),
    );
    expect(rejected).toBeNull();
    const conv = store.get("c")!;
    expect(conv.results).toHaveLength(0);
    expect(conv.journey.from).toBeUndefined();
  });

  it("prunes unbounded message history", () => {
    for (let i = 0; i < 25; i++) {
      store.beginTurn("c", `t${i}`, `msg ${i}`);
      store.appendAssistant("c", `reply ${i}`);
    }
    const conv = store.get("c")!;
    expect(conv.messages.length).toBeLessThanOrEqual(16);
    expect(conv.messages.at(-1)?.content).toBe("reply 24");
  });

  it("context block carries TODAY, journey context and result statuses", () => {
    store.beginTurn("c", "t1", "q");
    store.recordToolResult("c", "t1", "SEARCH_TRAINS", { from: "LDH", to: "NDLS", date: "2026-10-11" }, toolResult("SEARCH_TRAINS", { status: "not_configured" }));
    const block = store.buildContextBlock(store.get("c")!, "t1", "2026-10-10");
    expect(block).toContain("TODAY: 2026-10-10");
    expect(block).toContain("route: LDH → NDLS");
    expect(block).toContain("status=not_configured");
  });
});
