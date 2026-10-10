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
  it("reports all 8 capabilities unconfigured, LLM off, booking disabled — no secrets", async () => {
    const res = await healthGET();
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.llm.configured).toBe(false);
    expect(json.booking.enabled).toBe(false);
    expect(json.booking.integrationPresent).toBe(false);
    expect(json.railway.capabilities).toHaveLength(8);
    expect(json.railway.capabilities.every((c: { configured: boolean }) => c.configured === false)).toBe(true);
    expect(JSON.stringify(json)).not.toMatch(/API_KEY/);
  });
});

describe("railway routes in the unconfigured state (requirement 5)", () => {
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
      expect(typeof env.retrievedAt).toBe("string");
      expect(typeof env.requestId).toBe("string");
    });
  }
});

describe("input validation", () => {
  it("search requires text or from+to", async () => {
    const res = await searchGET(new Request(`${base}/api/railway/search`));
    expect(res.status).toBe(400);
  });

  it("search rejects malformed dates", async () => {
    const res = await searchGET(new Request(`${base}/api/railway/search?text=x&date=10-10-2026`));
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

describe("POST /api/assistant", () => {
  it("answers honestly when neither provider nor LLM is configured", async () => {
    const res = await assistantPOST(
      new Request(`${base}/api/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "PNR 1234567890 ka status batao" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.notConfigured).toBe(true);
    expect(json.text.toLowerCase()).toContain("authorized");
    expect(json.text).not.toMatch(/\bCNF\b|\bRAC\b/i);
  });

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
});
