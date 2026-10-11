import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  __clearConfirmtktCaches,
  confirmtktAdapter,
} from "@/providers/adapters/confirmtkt-v1";
import type { QueryContext, TrainSearchProvider } from "@/providers/types";

/**
 * PROMPT 15 §5 — the politeness cache must NEVER block an explicitly fresh
 * enquiry: cached by default (quota-friendly), bypassed when refresh=true.
 */
const q = { from: "LDH", to: "NDLS", date: "2026-10-12" };
const ctx = (refresh?: boolean) =>
  ({ locale: "en", requestId: `c-${String(refresh)}`, refresh }) as QueryContext;

const SEARCH_PAYLOAD = {
  data: {
    trainList: [
      {
        trainNumber: "12014",
        trainName: "ASR SHTBDI",
        fromStnCode: "LDH",
        fromStnName: "Ludhiana Jn",
        toStnCode: "NDLS",
        toStnName: "New Delhi",
        departureTime: "05:55",
        arrivalTime: "11:02",
        duration: 307,
        distance: 372,
        classes: ["CC"],
      },
    ],
  },
};
const SUGGEST = {
  data: {
    stationList: [
      { stationCode: "LDH", stationName: "Ludhiana Jn", city: "Ludhiana", state: "Punjab", majorStn: false },
      { stationCode: "NDLS", stationName: "New Delhi", city: "New Delhi", state: "Delhi", majorStn: true },
    ],
  },
};

let searchCalls = 0;

beforeEach(() => {
  __clearConfirmtktCaches();
  searchCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/trains/search")) {
        searchCalls += 1;
        return new Response(JSON.stringify(SEARCH_PAYLOAD), { status: 200 });
      }
      return new Response(JSON.stringify(SUGGEST), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const search = (c: QueryContext) =>
  (confirmtktAdapter as unknown as TrainSearchProvider).search(q, c);

it("second identical enquiry is served from cache (quota-friendly)", async () => {
  const a = await search(ctx(false));
  expect(a.data?.length).toBe(1);
  const first = searchCalls;
  expect(first).toBeGreaterThan(0);
  await search(ctx(false));
  expect(searchCalls).toBe(first); // no duplicate upstream request
});

it("refresh=true bypasses the cache and re-queries the provider", async () => {
  await search(ctx(false));
  const before = searchCalls;
  const b = await search(ctx(true));
  expect(b.data?.length).toBe(1);
  expect(searchCalls).toBe(before + 1); // fresh authoritative check honoured
});
