import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearRailYatriSeatCaches,
  parseSeatEnquiry,
  railyatriSeatAdapter,
} from "@/providers/adapters/railyatri-seat-v1";
import { isNotConfigured } from "@/providers/envelope";
import { envelopeContractViolations } from "../../contract/contract-suite";
import type { QueryContext } from "@/providers/types";

/**
 * railyatri-seat-v1 adapter tests.
 *
 * AUTOMATED tests with MOCKED fetch responses — the fixture payloads below
 * are TEST DATA modelled on the field names in RailYatri's own JS bundle
 * (seat_availibility / class_type / availablity_date). They are NOT live
 * railway data: the real gateway is blocked without an owner-supplied user
 * id, so live verification of this adapter is explicitly BLOCKED.
 */

const KEY_ENV = "RAILWAY_PROVIDER_RAILYATRI_SEAT_V1_KEY";
const FAKE_USER_ID = "-123456789";
const ctx: QueryContext = { locale: "en", requestId: "req-ry" };

// Fixture success payload (shape from RailYatri's JS: seat_availibility[0][class_type])
const OK_PAYLOAD = {
  success: true,
  train_number: "12904",
  seat_availibility: [{ class_type: "3A", "3A": "WL 65" }],
  availablity_date: "12-10-2026 09:15",
};

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  process.env[KEY_ENV] = FAKE_USER_ID;
  fetchMock = vi.fn(async () => jsonResponse(OK_PAYLOAD));
  vi.stubGlobal("fetch", fetchMock);
  __clearRailYatriSeatCaches();
});

afterEach(() => {
  delete process.env[KEY_ENV];
  vi.unstubAllGlobals();
  __clearRailYatriSeatCaches();
});

describe("railyatri-seat-v1 — parser (fixture shapes, NOT live data)", () => {
  it("maps a string class value and the provider-reported as-of date", () => {
    const parsed = parseSeatEnquiry(OK_PAYLOAD, "3A");
    expect(parsed).not.toBeNull();
    expect(parsed!.cls).toEqual({
      classCode: "3A",
      status: "WL 65",
      seatsText: "WL 65",
      asOf: "12-10-2026 09:15",
    });
  });

  it("maps an object class value with status + seat count", () => {
    const parsed = parseSeatEnquiry(
      { success: true, seat_availibility: [{ class_type: "SL", SL: { status: "AVAILABLE-25", seat_count: 25 } }] },
      "SL",
    );
    expect(parsed!.cls).toEqual({ classCode: "SL", status: "AVAILABLE-25", seatsText: "25", asOf: null });
  });

  it("returns null for shapes it cannot verify (caller reports honestly)", () => {
    expect(parseSeatEnquiry({ success: true, seat_availibility: [{ class_type: "3A", "3A": 42 }] }, "3A")).toBeNull();
    expect(parseSeatEnquiry({ success: true, seat_availibility: [] }, "3A")).toBeNull();
    expect(parseSeatEnquiry({ success: true }, "3A")).toBeNull();
  });
});

describe("railyatri-seat-v1 — adapter behaviour", () => {
  it("is honestly NOT_CONFIGURED without the owner's user id", async () => {
    delete process.env[KEY_ENV];
    const env = await railyatriSeatAdapter.availability(
      { trainId: "12904", date: "2026-10-12", from: "ASR", to: "NDLS", classCode: "3A" },
      ctx,
    );
    expect(isNotConfigured(env)).toBe(true);
    expect(env.data).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects station names (needs codes) with VALIDATION_FAILED", async () => {
    const env = await railyatriSeatAdapter.availability(
      { trainId: "12904", date: "2026-10-12", from: "Amritsar", to: "Delhi", classCode: "3A" },
      ctx,
    );
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("VALIDATION_FAILED");
  });

  it("maps a successful enquiry into the availability schema with attribution", async () => {
    const env = await railyatriSeatAdapter.availability(
      { trainId: "12904", date: "2026-10-12", from: "ASR", to: "NDLS", classCode: "3A" },
      ctx,
    );
    expect(env.data).not.toBeNull();
    expect(env.data!.classes[0]).toMatchObject({ classCode: "3A", status: "WL 65", asOf: "12-10-2026 09:15" });
    expect(env.source.providerId).toBe("railyatri-seat-v1");
    // the user id is a credential — it must never appear in the envelope
    expect(envelopeContractViolations(env, { secrets: [FAKE_USER_ID] })).toEqual([]);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/seat/enquiry/12904/12-10-2026/ASR/NDLS/3A/GN.json");
  });

  it("surfaces 'Invalid User Id.' as a NON-retryable upstream error (config problem)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ success: false, message: "Invalid User Id." }));
    const env = await railyatriSeatAdapter.availability(
      { trainId: "12904", date: "2026-10-12", from: "ASR", to: "NDLS", classCode: "3A" },
      ctx,
    );
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("UPSTREAM_ERROR");
    expect(env.errors[0].retryable).toBe(false);
    expect(envelopeContractViolations(env, { secrets: [FAKE_USER_ID] })).toEqual([]);
  });

  it("unverifiable payload → VALIDATION_FAILED, never invented availability", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ success: true, seat_availibility: [{ weird: true }] }));
    const env = await railyatriSeatAdapter.availability(
      { trainId: "12904", date: "2026-10-12", from: "ASR", to: "NDLS", classCode: "3A" },
      ctx,
    );
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("VALIDATION_FAILED");
  });

  it("without a classCode it queries the default classes in parallel and merges results", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      const cls = u.includes("/3A/") ? "3A" : u.includes("/SL/") ? "SL" : u.includes("/2A/") ? "2A" : "1A";
      if (cls === "1A") return jsonResponse({ success: true, seat_availibility: [{ nope: 1 }] }); // unparsable
      return jsonResponse({ success: true, seat_availibility: [{ class_type: cls, [cls]: cls === "SL" ? "AVL 12" : "WL 4" }] });
    });
    const env = await railyatriSeatAdapter.availability(
      { trainId: "12904", date: "2026-10-12", from: "ASR", to: "NDLS" },
      ctx,
    );
    // classes are queried sequentially (polite to the source, and a
    // credential rejection short-circuits the rest)
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(env.data!.classes.map((c) => c.classCode).sort()).toEqual(["2A", "3A", "SL"]);
  });

  it("cache serves repeats; refresh:true forces a fresh upstream call", async () => {
    const q = { trainId: "12904", date: "2026-10-12", from: "ASR", to: "NDLS", classCode: "3A" };
    await railyatriSeatAdapter.availability(q, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await railyatriSeatAdapter.availability(q, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1); // cached
    await railyatriSeatAdapter.availability(q, { ...ctx, refresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2); // explicit re-check bypasses cache
  });
});
