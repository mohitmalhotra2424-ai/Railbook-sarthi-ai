import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearWebDataCaches,
  extractLtsFromNextData,
  parseConfirmTktSchedule,
  parseLtsPayload,
  parseTrainSpnrSchedule,
  webDataAdapter,
} from "@/providers/adapters/web-data-v1";
import type { QueryContext } from "@/providers/types";
import { envelopeContractViolations } from "../../contract/contract-suite";

const ctx: QueryContext = { locale: "en", requestId: "req-w" };

/* Fixtures shaped like the live pages captured on 2026-10-10. */

const TPNS_HTML = `<html><head><title>12904 Golden Temple Mail Train Schedule | trainspnrstatus</title></head><body><table>
<tr><th>#</th><th>Station</th></tr>
<tr><td>1</td><td>AMRITSAR</td><td>ASR</td><td>--:--</td><td>18:55</td><td>-</td><td>0</td><td>0</td><td>km</td><td>Day</td><td>1</td></tr>
<tr><td>2</td><td>ATTARI</td><td>ATT</td><td>19:18</td><td>19:23</td><td>-</td><td>5</td><td>25</td><td>km</td><td>Day</td><td>1</td></tr>
<tr><td>3</td><td>LUDHIANA JN</td><td>LDH</td><td>01:10</td><td>01:20</td><td>-</td><td>10</td><td>249</td><td>km</td><td>Day</td><td>2</td></tr>
<tr><td>4</td><td>MUMBAI CENTRAL</td><td>MMCT</td><td>23:35</td><td>--:--</td><td>-</td><td>0</td><td>1800</td><td>km</td><td>Day</td><td>2</td></tr>
</table></body></html>`;

const CTKT_HTML = `<html><head><title>12904 Golden Temple Mail Schedule, Route, Time Table</title></head><body><table>
<tr><td></td><td>1</td><td></td><td>Amritsar Jn - ASR</td><td></td><td>Start</td><td></td><td>18:55</td><td>--&gt;</td><td>0.0 km</td><td>1</td></tr>
<tr><td></td><td>2</td><td></td><td>Attari - ATT</td><td></td><td>19:18</td><td></td><td>19:23</td><td>--&gt;</td><td>25.0 km</td><td>1</td></tr>
<tr><td></td><td>3</td><td></td><td>Ludhiana Jn - LDH</td><td></td><td>01:10</td><td></td><td>01:20</td><td>--&gt;</td><td>249.0 km</td><td>2</td></tr>
<tr><td></td><td>4</td><td></td><td>Mumbai Central - MMCT</td><td></td><td>23:35</td><td></td><td>End</td><td>--&gt;</td><td>1800 km</td><td>2</td></tr>
</table></body></html>`;

const LTS_PAYLOAD = {
  success: true,
  train_number: "12904",
  train_name: "Golden Temple Mail",
  is_run_day: true,
  at_dstn: false,
  current_station_code: "CEU",
  current_station_name: "CHIHERU~",
  delay: 1,
  status_as_of: "As of 28 mins ago",
};

function stubFetch(responder: (url: string) => { status?: number; body: string | null }) {
  const fn = vi.fn(async (url: string | URL) => {
    const r = responder(String(url));
    if (r.body === null) throw new Error("network down");
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => r.body } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => __clearWebDataCaches());
afterEach(() => {
  vi.unstubAllGlobals();
  __clearWebDataCaches();
});

describe("web-data-v1 — schedule parsers", () => {
  it("parses trainspnrstatus rows (source/mid/destination)", () => {
    const entries = parseTrainSpnrSchedule(TPNS_HTML);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ sequence: 1, station: { code: "ASR", name: "AMRITSAR" }, arrival: null, departure: "18:55", haltMinutes: 0 });
    expect(entries[1]).toMatchObject({ station: { code: "ATT" }, arrival: "19:18", departure: "19:23", haltMinutes: 5 });
    expect(entries[3]).toMatchObject({ station: { code: "MMCT" }, arrival: "23:35", departure: null });
  });

  it("parses confirmtkt rows incl. Start/End handling", () => {
    const entries = parseConfirmTktSchedule(CTKT_HTML);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ sequence: 1, station: { code: "ASR", name: "Amritsar Jn" }, arrival: null, departure: "18:55" });
    expect(entries[2]).toMatchObject({ station: { code: "LDH" }, arrival: "01:10", departure: "01:20" });
    expect(entries[3]).toMatchObject({ station: { code: "MMCT" }, arrival: "23:35", departure: null });
  });
});

describe("web-data-v1 — timetable chain (owner rule: first with 3+ stops wins)", () => {
  it("ixigo yields nothing server-side → confirmtkt answers", async () => {
    const calls: string[] = [];
    stubFetch((url) => {
      calls.push(url);
      if (url.includes("ixigo.com")) return { body: "<html>js shell, no data</html>" };
      if (url.includes("confirmtkt.com")) return { body: CTKT_HTML };
      return { body: null };
    });
    const env = await webDataAdapter.timetable("12904", "2026-10-12", ctx);
    expect(env.data).not.toBeNull();
    expect(env.data!.entries).toHaveLength(4);
    expect(env.data!.trainName.toLowerCase()).toContain("golden temple");
    expect(calls.some((u) => u.includes("trainspnrstatus"))).toBe(false); // chain stopped at first winner
    expect(envelopeContractViolations(env)).toEqual([]);
  });

  it("403 on a source is treated as null → next source tried", async () => {
    stubFetch((url) => {
      if (url.includes("ixigo.com")) return { status: 403, body: "blocked" };
      if (url.includes("confirmtkt.com")) return { status: 403, body: "blocked" };
      if (url.includes("trainspnrstatus.com")) return { body: TPNS_HTML };
      return { body: null };
    });
    const env = await webDataAdapter.timetable("12904", undefined, ctx);
    expect(env.data).not.toBeNull();
    expect(env.data!.entries).toHaveLength(4);
  });

  it("all sources fail → honest retryable error, never a fabricated schedule", async () => {
    stubFetch(() => ({ status: 500, body: "nope" }));
    const env = await webDataAdapter.timetable("12904", "2026-10-12", ctx);
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("UPSTREAM_ERROR");
    expect(env.errors[0].retryable).toBe(true);
  });

  it("nameless page (confirmtkt-style title) uses an explicit placeholder, never a guessed name", async () => {
    const nameless = `<html><head><title>12904 Train Route and Schedule</title></head><body><table>${TPNS_HTML.match(/<tr><td>[\s\S]*<\/table>/)?.[0] ?? ""}</table></body></html>`;
    stubFetch((url) => {
      if (url.includes("ixigo.com")) return { body: "<html>js shell</html>" };
      if (url.includes("trainspnrstatus.com")) return { body: nameless };
      return { body: null };
    });
    const env = await webDataAdapter.timetable("12904", "2026-10-12", ctx);
    expect(env.data!.trainName).toBe("Train 12904");
  });
});

describe("web-data-v1 — live status chain", () => {
  it("maps the RailYatri eta payload to LiveStatus", () => {
    const status = parseLtsPayload(LTS_PAYLOAD)!;
    expect(status).toMatchObject({
      trainNumber: "12904",
      trainName: "Golden Temple Mail",
      running: true,
      lastStation: { code: "CEU", name: "CHIHERU" },
      delayMinutes: 1,
      updatedAt: "As of 28 mins ago",
    });
  });

  it("non-run-day and arrived trains are honestly not running", () => {
    expect(parseLtsPayload({ ...LTS_PAYLOAD, is_run_day: false })!.running).toBe(false);
    expect(parseLtsPayload({ ...LTS_PAYLOAD, at_dstn: true })!.running).toBe(false);
  });

  it("extracts ltsData from __NEXT_DATA__", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"ltsData":${JSON.stringify(LTS_PAYLOAD)}}}}</script>`;
    expect(extractLtsFromNextData(html)).toMatchObject({ train_number: "12904" });
  });

  it("eta API answers first; page and railenquiry are not called", async () => {
    const calls: string[] = [];
    stubFetch((url) => {
      calls.push(url);
      if (url.includes("livestatus.railyatri.in")) return { body: JSON.stringify(LTS_PAYLOAD) };
      return { body: null };
    });
    const env = await webDataAdapter.liveStatus("12904", "2026-10-10", ctx);
    expect(env.data).toMatchObject({ trainNumber: "12904", running: true, delayMinutes: 1 });
    expect(calls).toHaveLength(1); // daysBack=0 answered; no further sources
    expect(envelopeContractViolations(env)).toEqual([]);
  });

  it("falls back to the __NEXT_DATA__ page when the eta API fails", async () => {
    stubFetch((url) => {
      if (url.includes("livestatus.railyatri.in")) return { status: 500, body: "down" };
      if (url.includes("live-train-status")) {
        return { body: `<script id="__NEXT_DATA__" type="application/json">{"props":{"ltsData":${JSON.stringify(LTS_PAYLOAD)}}}</script>` };
      }
      return { body: null };
    });
    const env = await webDataAdapter.liveStatus("12904", "2026-10-10", ctx);
    expect(env.data).toMatchObject({ trainNumber: "12904", running: true });
  });

  it("all sources failing → honest retryable error", async () => {
    stubFetch(() => ({ status: 503, body: "down" }));
    const env = await webDataAdapter.liveStatus("12904", "2026-10-10", ctx);
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("UPSTREAM_ERROR");
    expect(env.errors[0].retryable).toBe(true);
  });

  it("60s live cache serves repeats, but refresh:true re-checks the source", async () => {
    const etaCalls: string[] = [];
    stubFetch((url) => {
      if (url.includes("livestatus.railyatri.in")) {
        etaCalls.push(url);
        return { body: JSON.stringify(LTS_PAYLOAD) };
      }
      return { body: null };
    });
    await webDataAdapter.liveStatus("12904", "2026-10-10", ctx);
    expect(etaCalls).toHaveLength(1);
    await webDataAdapter.liveStatus("12904", "2026-10-10", ctx); // cached
    expect(etaCalls).toHaveLength(1);
    await webDataAdapter.liveStatus("12904", "2026-10-10", { ...ctx, refresh: true }); // explicit re-check
    expect(etaCalls).toHaveLength(2);
  });
});
