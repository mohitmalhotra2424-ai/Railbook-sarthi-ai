import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearErailCaches,
  __setMinStationsForTest,
  erailAdapter,
  parseErailTbs,
  parseFareTable,
  parseSelectedPair,
  parseStationsJs,
} from "@/providers/adapters/erail-v1";
import type { QueryContext } from "@/providers/types";
import { envelopeContractViolations } from "../../contract/contract-suite";

const ctx: QueryContext = { locale: "en", requestId: "req-e" };

/* Real-shaped fixtures — field layout verified against the live payload on 2026-10-10. */

const TBS_BODY = [
  "~LDH~Ludhiana Jn~BEAS~Beas~~2025-10-20-5-45-17~~~",
  "12013~AMRITSAR SHTABDI~New Delhi~NDLS~Amritsar Jn~ASR~Ludhiana Jn~LDH~Beas~BEAS~20.19~21.58~01.39~1111111~~~~~~~~000100000010000~3~2~1~4~16.30~23.05~7~1111111~20.16~22.00~SHATABDI~1457~1~0~DATASOURCE_IR~2025-10-19~2030-10-19~93~56~SHATABDI:93:x~0~0~~60~1~2013~~~Shatabdi~~1~NR~~BG~x~x~011000000100~x~0~1~CC:103:118:::::::2:12:|EA:4::::::::::|EC:5::::::::2::|",
  "64551~LDH ASR MEMU~Ludhiana Jn~LDH~Chheharta~CIA~Ludhiana Jn~LDH~Beas~BEAS~08.30~10.50~02.20~1111111~~~~~~~~000000001000000~0~5~0~1~08.30~12.30~15~1111111~First~10.55~ORDINARY~1268~1~0~DATASOURCE_TE~2025-10-19~2030-10-19~93~40~ORDINARY:93:x~0~0~~60~1~1AJLNR~~~MEMU~~1~NR~~BG~x~x~100000000000~x~",
  "garbage record without enough fields",
].join("^");

const STATIONS_JS =
  'var StationsData="LDH,Ludhiana Jn,BEAS,Beas,NDLS,New Delhi,DLI,Delhi Jn,ASR,Amritsar Jn,HW,Haridwar Jn,ABCDEF,Bad Six Char Code,XY,Ok Code";';

const FARE_HTML = [
  "<form><table><tr><td><select name='from' on='change:form1.submit' >",
  "<option value='ASR' selected='selected'>Amritsar Jn</option><option value='LDH'>Ludhiana Jn</option></select></td>",
  "<td><select name='to' on='change:form1.submit'>",
  "<option value='ASR'>Amritsar Jn</option><option value='LDH' selected='selected'>Ludhiana Jn</option></select></td></tr></table></form>",
  "<div class='panel-heading'>Total fare for <b>1</b> Adult</div>",
  "<table class='tableSingleFare table table-bordered table-condensed'>",
  "<tr><th></th><th>1A</th><th>2A</th><th>3A</th><th>SL</th></tr>",
  "<tr><td>General</td><td><b>4,945</b></td><td><b>2,940</b></td><td><b>2,065</b></td><td><b>817</b></td></tr>",
  "<tr><td>Tatkal</td><td>-</td><td><b>3,465</b></td><td><b>2,480</b></td><td><b>1,015</b></td></tr>",
  "</table>",
].join("");

const FARE_HTML_MISMATCH = FARE_HTML.replace("<option value='LDH' selected='selected'>Ludhiana Jn</option>", "<option value='BDTS' selected='selected'>Bandra Terminus</option>");

function stubFetch(responder: (url: string) => { status?: number; body: string }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const r = responder(String(url));
      const status = r.status ?? 200;
      return { ok: status >= 200 && status < 300, status, text: async () => r.body } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  __clearErailCaches();
  __setMinStationsForTest(5);
  stubFetch((url) => {
    if (url.includes("stations.js")) return { body: STATIONS_JS };
    if (url.includes("getTrains.aspx")) return { body: TBS_BODY };
    if (url.includes("train-fare")) return { body: FARE_HTML };
    throw new Error(`unexpected fetch: ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  __clearErailCaches();
  __setMinStationsForTest(1000);
});

describe("erail-v1 — parsers", () => {
  it("parses the ~/^ TBS feed: times HH.MM→HH:MM, classes from field 62", () => {
    const { trains, throttled } = parseErailTbs(TBS_BODY);
    expect(throttled).toBe(false);
    expect(trains).toHaveLength(2);
    expect(trains[0]).toMatchObject({
      trainNumber: "12013",
      trainName: "AMRITSAR SHTABDI",
      from: { code: "LDH", name: "Ludhiana Jn" },
      to: { code: "BEAS", name: "Beas" },
      departure: "20:19",
      arrival: "21:58",
      classes: ["CC", "EA", "EC"],
    });
    expect(trains[1].classes).toBeUndefined(); // MEMU has no reserved-class block — never invented
  });

  it("recognises the throttle response", () => {
    expect(parseErailTbs("~~~~~Please try again after some time.").throttled).toBe(true);
  });

  it("parses stations.js code/name pairs and skips malformed entries", () => {
    const stations = parseStationsJs(STATIONS_JS);
    expect(stations).toContainEqual({ code: "LDH", name: "Ludhiana Jn" });
    expect(stations).toContainEqual({ code: "HW", name: "Haridwar Jn" });
    expect(stations.find((s) => s.code === "ABCDEF")).toBeUndefined();
  });

  it("parses the fare table and the selected from/to pair", () => {
    expect(parseSelectedPair(FARE_HTML)).toEqual({ from: "ASR", to: "LDH" });
    const table = parseFareTable(FARE_HTML)!;
    expect(table.headers).toEqual(["1A", "2A", "3A", "SL"]);
    expect(table.rows["General"]).toMatchObject({ "1A": 4945, SL: 817 });
    expect(table.rows["Tatkal"]["3A"]).toBe(2480);
    expect(table.rows["Tatkal"]["1A"]).toBeUndefined(); // "-" is not a fare
  });
});

describe("erail-v1 — search", () => {
  it("resolves station NAMES via the local table and returns trains", async () => {
    const env = await erailAdapter.search({ from: "Ludhiana Jn", to: "Beas", date: "2026-10-12" }, ctx);
    expect(env.data).toHaveLength(2);
    expect(env.source.providerId).toBe("erail-v1");
    expect(envelopeContractViolations(env)).toEqual([]);
  });

  it("unknown station → NOT_FOUND, never a guessed code", async () => {
    const env = await erailAdapter.search({ from: "Nowhereville", to: "BEAS", date: "2026-10-12" }, ctx);
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("NOT_FOUND");
    expect(env.errors[0].retryable).toBe(false);
  });

  it("throttling → retryable RATE_LIMITED, never fabricated trains", async () => {
    stubFetch((url) => {
      if (url.includes("stations.js")) return { body: STATIONS_JS };
      return { body: "~~~~~Please try again after some time." };
    });
    const env = await erailAdapter.search({ from: "LDH", to: "BEAS", date: "2026-10-12" }, ctx);
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("RATE_LIMITED");
    expect(env.errors[0].retryable).toBe(true);
  });
});

describe("erail-v1 — fare", () => {
  it("returns the General-quota fare when the page's selected pair matches", async () => {
    const env = await erailAdapter.fare({ trainId: "12904", from: "ASR", to: "LDH", classCode: "3A" }, ctx);
    expect(env.data).toMatchObject({ trainNumber: "12904", classCode: "3A", baseFare: 2065, totalFare: 2065, currency: "INR" });
    expect(envelopeContractViolations(env)).toEqual([]);
  });

  it("tatkal quota reads the Tatkal row", async () => {
    const env = await erailAdapter.fare({ trainId: "12904", from: "ASR", to: "LDH", classCode: "3A", quota: "TQ" }, ctx);
    expect(env.data!.totalFare).toBe(2480);
  });

  it("REFUSES a mismatched route fare (page fell back to full route)", async () => {
    stubFetch((url) => {
      if (url.includes("stations.js")) return { body: STATIONS_JS };
      return { body: FARE_HTML_MISMATCH };
    });
    const env = await erailAdapter.fare({ trainId: "12904", from: "ASR", to: "HW", classCode: "3A" }, ctx);
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("NOT_FOUND");
    expect(env.errors[0].message).toContain("BDTS");
    expect(env.errors[0].message).toContain("refusing");
  });

  it("unpublished class → NOT_FOUND", async () => {
    const env = await erailAdapter.fare({ trainId: "12904", from: "ASR", to: "LDH", classCode: "CC" }, ctx);
    expect(env.data).toBeNull();
    expect(env.errors[0].code).toBe("NOT_FOUND");
  });
});
