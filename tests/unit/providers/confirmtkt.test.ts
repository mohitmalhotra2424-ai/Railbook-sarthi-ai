import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearConfirmtktCaches,
  confirmtktAdapter,
  lookupStations,
} from "@/providers/adapters/confirmtkt-v1";
import type { QueryContext } from "@/providers/types";
import { envelopeContractViolations } from "../../contract/contract-suite";

const ctx: QueryContext = { locale: "en", requestId: "req-1" };

/* ---------------- fixtures (shape verified against the live endpoint 2026-10-10) ---------------- */

const SEARCH_PAYLOAD = {
  data: {
    trainList: [
      {
        trainNumber: "12951",
        trainName: "MUMBAI RAJDHANI",
        fromStnCode: "LDH",
        fromStnName: "Ludhiana Jn",
        toStnCode: "NDLS",
        toStnName: "New Delhi",
        departureTime: "01:10",
        arrivalTime: "04:55",
        duration: 225,
        distance: 329,
        availabilityCache: {
          "3A": {
            availability: "AVAILABLE-25",
            availabilityDisplayName: "AVL 25",
            fare: "1105",
            quota: "GN",
            confirmTktStatus: "Confirm",
            predictionPercentage: 100,
          },
          SL: {
            availability: "RLWL4/WL4",
            availabilityDisplayName: "WL 4",
            fare: "195",
            quota: "GN",
            predictionPercentage: 72,
          },
        },
      },
      {
        trainNumber: 12013, // live API sometimes emits numbers as JSON numbers
        trainName: "SHATABDI EXP",
        fromStnCode: "LDH",
        fromStnName: "Ludhiana Jn",
        toStnCode: "NDLS",
        toStnName: "New Delhi",
        departureTime: "19:43",
        arrivalTime: "22:55",
        duration: 192,
        distance: 329,
        availabilityCache: {
          CC: { availability: "AVAILABLE-12", availabilityDisplayName: "AVL 12", fare: "855", quota: "GN" },
        },
      },
    ],
  },
};

const SUGGEST_DELHI = {
  data: {
    stationList: [
      { stationCode: "NDLS", stationName: "New Delhi", city: "New Delhi", state: "Delhi", majorStn: true },
      { stationCode: "DLI", stationName: "Delhi Jn", city: "Delhi", state: "Delhi", majorStn: false },
    ],
  },
};

const SUGGEST_LUDHIANA = {
  data: {
    stationList: [
      { stationCode: "LDH", stationName: "Ludhiana Jn", city: "Ludhiana", state: "Punjab", majorStn: false },
    ],
  },
};

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  __clearConfirmtktCaches();
  fetchMock = vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("auto-suggestion")) {
      if (u.includes("searchString=delhi") || u.includes("searchString=ndls")) return jsonResponse(SUGGEST_DELHI);
      return jsonResponse(SUGGEST_LUDHIANA);
    }
    if (u.includes("/api/v1/trains/search")) return jsonResponse(SEARCH_PAYLOAD);
    throw new Error(`unexpected fetch: ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  __clearConfirmtktCaches();
});

describe("confirmtkt-v1 adapter — trainSearch", () => {
  it("resolves station names via live autocomplete and maps trains", async () => {
    const env = await confirmtktAdapter.search(
      { from: "Ludhiana", to: "Delhi", date: "2026-10-12" },
      ctx,
    );
    expect(env.data).not.toBeNull();
    expect(env.data!.map((t) => t.trainNumber)).toEqual(["12951", "12013"]); // numeric trainNumber coerced
    expect(env.data![0].trainName).toBe("MUMBAI RAJDHANI");
    expect(env.data![0].from).toEqual({ code: "LDH", name: "Ludhiana Jn" });
    expect(env.data![0].classes).toEqual(["3A", "SL"]);
    expect(env.source.providerId).toBe("confirmtkt-v1");
    expect(envelopeContractViolations(env, { secrets: ["ct-web!2$"] })).toEqual([]);
  });

  it("sends DD-MM-YYYY and resolved codes upstream", async () => {
    await confirmtktAdapter.search({ from: "Ludhiana", to: "Delhi", date: "2026-10-12" }, ctx);
    const searchCall = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes("trains/search"))!;
    expect(searchCall).toContain("sourceStationCode=LDH");
    expect(searchCall).toContain("destinationStationCode=NDLS"); // major station preferred
    expect(searchCall).toContain("dateOfJourney=12-10-2026");
  });

  it("accepts station codes without an autocomplete round-trip", async () => {
    const env = await confirmtktAdapter.search({ from: "LDH", to: "NDLS", date: "2026-10-12" }, ctx);
    expect(env.data).toHaveLength(2);
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("auto-suggestion"))).toBe(true);
  });

  it("resolves lowercase codes via autocomplete (not mistaken for words)", async () => {
    const env = await confirmtktAdapter.search({ from: "ldh", to: "ndls", date: "2026-10-12" }, ctx);
    expect(env.data).toHaveLength(2);
    const searchCall = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes("trains/search"))!;
    expect(searchCall).toContain("sourceStationCode=LDH");
  });

  it("rejects an invalid journey date without calling upstream", async () => {
    const env = await confirmtktAdapter.search({ from: "LDH", to: "NDLS", date: "12/10/2026" }, ctx);
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("VALIDATION_FAILED");
  });

  it("surfaces HTTP failures as retryable UPSTREAM_ERROR, never fabricated data", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("trains/search")) return jsonResponse({}, 500);
      return jsonResponse(SUGGEST_LUDHIANA);
    });
    const env = await confirmtktAdapter.search({ from: "LDH", to: "NDLS", date: "2026-10-12" }, ctx);
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("UPSTREAM_ERROR");
    expect(env.errors[0].retryable).toBe(true);
    expect(envelopeContractViolations(env, { secrets: ["ct-web!2$"] })).toEqual([]);
  });

  it("rejects payloads where no row parses (VALIDATION_FAILED, not silent emptiness)", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("trains/search")) {
        return jsonResponse({ data: { trainList: [{ trainNumber: "abc", trainName: "" }] } });
      }
      return jsonResponse(SUGGEST_LUDHIANA);
    });
    const env = await confirmtktAdapter.search({ from: "LDH", to: "NDLS", date: "2026-10-12" }, ctx);
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("VALIDATION_FAILED");
  });

  it("NOT_FOUND when a station name matches nothing", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("auto-suggestion")) return jsonResponse({ data: { stationList: [] } });
      return jsonResponse(SEARCH_PAYLOAD);
    });
    const env = await confirmtktAdapter.search({ from: "Nowhereville", to: "NDLS", date: "2026-10-12" }, ctx);
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("NOT_FOUND");
  });
});

describe("confirmtkt-v1 adapter — seatAvailability", () => {
  it("maps WL / AVL statuses honestly (valid outcomes, status ok)", async () => {
    const env = await confirmtktAdapter.availability(
      { trainId: "12951", date: "2026-10-12", from: "LDH", to: "NDLS" },
      ctx,
    );
    expect(env.data).not.toBeNull();
    const byClass = Object.fromEntries(env.data!.classes.map((c) => [c.classCode, c]));
    expect(byClass["3A"]).toEqual({ classCode: "3A", status: "AVL 25", seatsText: "AVAILABLE-25" });
    expect(byClass["SL"]).toEqual({ classCode: "SL", status: "WL 4", seatsText: "RLWL4/WL4" });
    expect(envelopeContractViolations(env, { secrets: ["ct-web!2$"] })).toEqual([]);
  });

  it("filters to the requested class", async () => {
    const env = await confirmtktAdapter.availability(
      { trainId: "12951", date: "2026-10-12", from: "LDH", to: "NDLS", classCode: "3A" },
      ctx,
    );
    expect(env.data!.classes).toHaveLength(1);
    expect(env.data!.classes[0].classCode).toBe("3A");
  });

  it("NOT_FOUND for a train absent from live results — never invents availability", async () => {
    const env = await confirmtktAdapter.availability(
      { trainId: "12345", date: "2026-10-12", from: "LDH", to: "NDLS" },
      ctx,
    );
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("NOT_FOUND");
    expect(env.errors[0].retryable).toBe(false);
  });
});

describe("confirmtkt-v1 adapter — fare", () => {
  it("returns the published fare as INR", async () => {
    const env = await confirmtktAdapter.fare(
      { trainId: "12013", from: "LDH", to: "NDLS", classCode: "CC", date: "2026-10-12" },
      ctx,
    );
    expect(env.data).toMatchObject({
      trainNumber: "12013",
      classCode: "CC",
      baseFare: 855,
      totalFare: 855,
      currency: "INR",
    });
    expect(envelopeContractViolations(env, { secrets: ["ct-web!2$"] })).toEqual([]);
  });

  it("NOT_FOUND for an unpublished class/quota combination", async () => {
    const env = await confirmtktAdapter.fare(
      { trainId: "12013", from: "LDH", to: "NDLS", classCode: "CC", quota: "TQ", date: "2026-10-12" },
      ctx,
    );
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("NOT_FOUND");
  });
});

describe("confirmtkt-v1 adapter — station lookup export", () => {
  it("returns live autocomplete matches", async () => {
    const stations = await lookupStations("delhi");
    expect(stations[0]).toMatchObject({ code: "NDLS", name: "New Delhi", major: true });
  });
});
