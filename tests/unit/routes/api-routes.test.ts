import { describe, expect, it } from "vitest";
import { POST as assistantPOST } from "@/app/api/assistant/route";
import { GET as healthGET } from "@/app/api/health/route";
import { GET as availabilityGET } from "@/app/api/railway/availability/route";
import { GET as cancellationsGET } from "@/app/api/railway/cancellations/route";
import { GET as fareGET } from "@/app/api/railway/fare/route";
import { GET as liveStatusGET } from "@/app/api/railway/live-status/route";
import { GET as pnrGET } from "@/app/api/railway/pnr/[pnr]/route";
import { GET as searchGET } from "@/app/api/railway/search/route";
import { GET as timetableGET } from "@/app/api/railway/timetable/[id]/route";
import { GET as trainGET } from "@/app/api/railway/train/[id]/route";

const base = "http://localhost";

describe("GET /api/health", () => {
  it("reports LLM/railway/booking status without any key material", async () => {
    const res = await healthGET();
    const raw = await res.text();
    const json = JSON.parse(raw);

    expect(json.ok).toBe(true);
    // No LLM configured in the test environment — reported honestly as null.
    expect(json.llm.primary).toBeNull();
    expect(json.llm.fallback).toBeNull();
    expect(json.booking.enabled).toBe(false);
    expect(json.booking.integrationPresent).toBe(false);
    expect(json.railway.capabilities).toHaveLength(8);
    expect(json.railway.capabilities.every((c: { configured: boolean }) => c.configured === false)).toBe(true);
    expect(raw).not.toMatch(/API_KEY|nvapi-/);
  });
});

describe("railway routes in the unconfigured state (no fabricated data)", () => {
  const cases: { name: string; call: () => Promise<Response> }[] = [
    { name: "search", call: () => searchGET(new Request(`${base}/api/railway/search?text=rajdhani`)) },
    { name: "train details", call: () => trainGET(new Request(`${base}/api/railway/train/12951`), { params: Promise.resolve({ id: "12951" }) }) },
    { name: "timetable", call: () => timetableGET(new Request(`${base}/api/railway/timetable/12951`), { params: Promise.resolve({ id: "12951" }) }) },
    { name: "live status", call: () => liveStatusGET(new Request(`${base}/api/railway/live-status?trainId=12951&date=2026-10-10`)) },
    { name: "availability", call: () => availabilityGET(new Request(`${base}/api/railway/availability?trainId=12951&date=2026-10-10&from=NDLS&to=BCT`)) },
    { name: "fare", call: () => fareGET(new Request(`${base}/api/railway/fare?trainId=12951&from=NDLS&to=BCT&classCode=3A`)) },
    { name: "pnr", call: () => pnrGET(new Request(`${base}/api/railway/pnr/1234567890`), { params: Promise.resolve({ pnr: "1234567890" }) }) },
    { name: "cancellations", call: () => cancellationsGET(new Request(`${base}/api/railway/cancellations`)) },
  ];

  for (const c of cases) {
    it(`${c.name} returns the canonical NOT_CONFIGURED envelope`, async () => {
      const res = await c.call();
      expect(res.status).toBe(200);
      const env = await res.json();
      expect(env.data).toBeNull();
      expect(env.errors[0].code).toBe("NOT_CONFIGURED");
      expect(env.errors[0].message).toContain("Live data provider not configured");
      expect(env.source.authorization).toBe("not-configured");
      expect(env.freshness).toBe("unknown");
    });
  }
});

describe("input validation", () => {
  it("search requires text or from+to", async () => {
    const res = await searchGET(new Request(`${base}/api/railway/search`));
    expect(res.status).toBe(400);
  });

  it("pnr route rejects non-10-digit PNRs", async () => {
    const res = await pnrGET(new Request(`${base}/api/railway/pnr/123`), {
      params: Promise.resolve({ pnr: "123" }),
    });
    expect(res.status).toBe(400);
  });

  it("train route rejects non-numeric ids", async () => {
    const res = await trainGET(new Request(`${base}/api/railway/train/rajdhani`), {
      params: Promise.resolve({ id: "rajdhani" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/assistant (SSE)", () => {
  it("rejects an empty message", async () => {
    const res = await assistantPOST(
      new Request(`${base}/api/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects malformed conversation ids", async () => {
    const res = await assistantPOST(
      new Request(`${base}/api/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hi", conversationId: "bad id!!" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("without LLM credentials streams an honest LLM_NOT_CONFIGURED error (no scripted reply)", async () => {
    const res = await assistantPOST(
      new Request(`${base}/api/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Ludhiana se Delhi ki trains batao" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain("LLM_NOT_CONFIGURED");
    expect(body).toContain('"type":"done"');
    // No fabricated railway facts in the stream.
    expect(body).not.toMatch(/\bCNF\b|\bRAC \d|\bWL\d/);
  });
});
