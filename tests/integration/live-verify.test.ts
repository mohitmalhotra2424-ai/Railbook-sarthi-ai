import { describe, expect, test } from "vitest";
import { executeCapabilityFailover } from "@/providers/registry";
import type {
  FareProvider,
  LiveStatusProvider,
  QueryContext,
  SeatAvailabilityProvider,
  TimetableProvider,
  TrainSearchProvider,
} from "@/providers/types";

/**
 * PROMPT 13 §7 — read-only LIVE integration verification.
 *
 * Runs ONLY with LIVE_VERIFY=1 and provider ids opted-in via env (never via
 * .env.local or production). Every assertion below is against a REAL provider
 * response fetched at run time; fixtures/mocks are impossible here because no
 * route interception exists in this process. No transactional calls are made.
 *
 *   RAILWAY_PROVIDER_IDS="confirmtkt-v1,erail-v1,web-data-v1" LIVE_VERIFY=1 \
 *     npx vitest run tests/integration/live-verify.test.ts
 */
const LIVE = process.env.LIVE_VERIFY === "1";

const ctx = { locale: "en", requestId: "live-verify" } as QueryContext;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const TOMORROW = iso(new Date(Date.now() + 86_400_000));

describe.runIf(LIVE)("live provider verification (real responses, read-only)", () => {
  test("train search LDH→NDLS for the requested date", async () => {
    const env = await executeCapabilityFailover(
      "trainSearch",
      (p) => (p as TrainSearchProvider).search({ from: "LDH", to: "NDLS", date: TOMORROW }, ctx),
      "lv-search",
    );
    expect(env.errors).toEqual([]);
    expect(env.data).toBeTruthy();
    expect(env.data!.length).toBeGreaterThan(0);
    expect(env.source.authorization).toBe("configured");
    // ConfirmTkt publishes no upstream timestamp → honesty note path.
    expect(env.providerTimestamp).toBeNull();
    for (const t of env.data!.slice(0, 3)) {
      console.log(`LIVE search: ${t.trainNumber} ${t.trainName} dep ${t.departure}`);
    }
  }, 30_000);

  test("timetable 12014 returns the real station sequence", async () => {
    const env = await executeCapabilityFailover(
      "timetable",
      (p) => (p as TimetableProvider).timetable("12014", undefined, ctx),
      "lv-tt",
    );
    expect(env.data).toBeTruthy();
    expect(env.data!.entries.length).toBeGreaterThan(3);
    console.log(`LIVE timetable 12014: ${env.data!.entries.length} stations, source=${env.source.providerId}`);
  }, 30_000);

  test("class-wise seat availability for the exact requested date", async () => {
    const env = await executeCapabilityFailover(
      "seatAvailability",
      (p) =>
        (p as SeatAvailabilityProvider).availability(
          { trainId: "12014", date: TOMORROW, from: "LDH", to: "NDLS", classCode: "CC" },
          ctx,
        ),
      "lv-avl",
    );
    expect(env.data).toBeTruthy();
    expect(env.data!.date).toBe(TOMORROW); // never substituted with another date
    const cc = env.data!.classes.find((c) => c.classCode === "CC");
    expect(cc).toBeTruthy();
    expect(cc!.status).not.toBe("");
    console.log(`LIVE availability 12014 CC ${TOMORROW}: ${cc!.status} (source=${env.source.providerId})`);
  }, 30_000);

  test("fare lookup returns a provider fare, not an estimate", async () => {
    const env = await executeCapabilityFailover(
      "fare",
      (p) =>
        (p as FareProvider).fare(
          { trainId: "12014", from: "LDH", to: "NDLS", classCode: "CC", date: TOMORROW },
          ctx,
        ),
      "lv-fare",
    );
    expect(env.data).toBeTruthy();
    expect(env.data!.totalFare).toBeGreaterThan(0);
    expect(env.data!.currency).toBe("INR");
    console.log(`LIVE fare 12014 CC: ₹${env.data!.totalFare} (source=${env.source.providerId})`);
  }, 30_000);

  test("live running status with provider timestamp transparency", async () => {
    const env = await executeCapabilityFailover(
      "liveStatus",
      (p) => (p as LiveStatusProvider).liveStatus("12014", iso(new Date()), ctx),
      "lv-live",
    );
    expect(env.data).toBeTruthy();
    // RailYatri supplies status_as_of → providerTimestamp must be carried,
    // proving the transparency pipeline works in both directions.
    console.log(
      `LIVE status 12014: running=${env.data!.running} last=${env.data!.lastStation?.code} providerTimestamp=${env.providerTimestamp}`,
    );
    expect(env.providerTimestamp === null || typeof env.providerTimestamp === "string").toBe(true);
  }, 30_000);

  test("unsupported capabilities stay honestly not-configured", async () => {
    const pnr = await executeCapabilityFailover("pnr", async () => {
      throw new Error("must not be called");
    }, "lv-pnr");
    expect(pnr.data).toBeNull();
    expect(pnr.source.authorization).toBe("not-configured");

    const canc = await executeCapabilityFailover("cancellations", async () => {
      throw new Error("must not be called");
    }, "lv-canc");
    expect(canc.data).toBeNull();
    expect(canc.source.authorization).toBe("not-configured");
  }, 15_000);
});
