import { describe, expect, it } from "vitest";
import { parseTimesFromLabel } from "@/assistant/booking/preparation";
import { conversationStore } from "@/assistant/context/store";
import { GET } from "@/app/api/passenger/route";
import type { ToolResult } from "@/assistant/tools/results";

/**
 * Prompt 33 — one-screen review support: provider-reported dep/arr times for
 * the selected train come ONLY from the current non-superseded search results
 * (never invented, never from a stale/superseded list). Readiness/review/
 * confirm boundaries themselves are covered by the p31/p32 suites.
 */

function toolResult(tool: string, over: Partial<ToolResult> = {}): ToolResult {
  return { tool, correlationId: `c:t:${tool}`, status: "ok", note: "n", ...over };
}

const rows = [
  { trainNumber: "12951", trainName: "Morning Express", departure: "06:15", arrival: "10:30" },
  { trainNumber: "12013", trainName: "Shatabdi", departure: "14:00" }, // no arrival reported
];

function seedSearch(convId: string, turnId: string, date: string) {
  conversationStore.beginTurn(convId, turnId, "search");
  conversationStore.recordToolResult(
    convId,
    turnId,
    "SEARCH_TRAINS",
    { from: "LDH", to: "NDLS", date },
    toolResult("SEARCH_TRAINS", { journeyDate: date, data: rows }),
  );
}

async function get(convId: string) {
  const res = await GET(new Request(`http://test.local/api/passenger?conversationId=${convId}`));
  return (await res.json()) as { ok: boolean; times: { departure: string; arrival: string | null } | null };
}

describe("parseTimesFromLabel", () => {
  it("extracts departure and arrival", () => {
    expect(parseTimesFromLabel("12030 SWARN SHATABDI dep 18:55 arr 22:50")).toEqual({
      departure: "18:55",
      arrival: "22:50",
    });
  });
  it("handles a row without arrival", () => {
    expect(parseTimesFromLabel("12013 Shatabdi dep 14:00")).toEqual({ departure: "14:00", arrival: null });
  });
  it("returns null when no times are reported — nothing is invented", () => {
    expect(parseTimesFromLabel("12951 Morning Express")).toBeNull();
    // a name containing "dep" as a word prefix must not match
    expect(parseTimesFromLabel("12951 DEPARTURE SPECIAL")).toBeNull();
  });
});

describe("GET /api/passenger times (authoritative-source rules)", () => {
  it("returns provider times for the selected train from the current search results", async () => {
    seedSearch("p33-unit-conv-a", "t1", "2026-10-12");
    conversationStore.setSelection("p33-unit-conv-a", {
      trainNumber: "12951",
      trainName: "Morning Express",
      from: "LDH",
      to: "NDLS",
      journeyDate: "2026-10-12",
      classes: ["SL", "3A"],
      selectedAt: new Date().toISOString(),
    });
    const body = await get("p33-unit-conv-a");
    expect(body.ok).toBe(true);
    expect(body.times).toEqual({ departure: "06:15", arrival: "10:30" });
  });

  it("returns null when the selected train is absent from the current results", async () => {
    seedSearch("p33-unit-conv-b", "t1", "2026-10-12");
    conversationStore.setSelection("p33-unit-conv-b", {
      trainNumber: "99999",
      from: "LDH",
      to: "NDLS",
      journeyDate: "2026-10-12",
      selectedAt: new Date().toISOString(),
    });
    expect((await get("p33-unit-conv-b")).times).toBeNull();
  });

  it("returns null when the search carrying the train was superseded (stale list never supplies data)", async () => {
    seedSearch("p33-unit-conv-c", "t1", "2026-10-12");
    conversationStore.setSelection("p33-unit-conv-c", {
      trainNumber: "12951",
      from: "LDH",
      to: "NDLS",
      journeyDate: "2026-10-12",
      selectedAt: new Date().toISOString(),
    });
    // A newer search for the same journey supersedes the older result version.
    // The new list does NOT contain 12951 — the stale list must never supply times.
    conversationStore.beginTurn("p33-unit-conv-c", "t2", "refresh");
    conversationStore.recordToolResult(
      "p33-unit-conv-c",
      "t2",
      "SEARCH_TRAINS",
      { from: "LDH", to: "NDLS", date: "2026-10-12" },
      toolResult("SEARCH_TRAINS", {
        journeyDate: "2026-10-12",
        data: [{ trainNumber: "12013", trainName: "Shatabdi", departure: "14:00" }],
      }),
    );
    expect((await get("p33-unit-conv-c")).times).toBeNull();
  });

  it("returns null times (not an error) when there is no selection or conversation", async () => {
    conversationStore.beginTurn("p33-unit-conv-d", "t1", "search");
    expect((await get("p33-unit-conv-d")).times).toBeNull();
  });
});
