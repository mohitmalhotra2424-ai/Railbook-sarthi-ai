import { expect, test } from "@playwright/test";

/**
 * Prompt 33 — TTS wiring (conversation mode auto-speak + re-listen) and the
 * dedicated review page. TEST DOUBLES only (headless has no real mic/TTS):
 * this verifies UI wiring, not real audio. Review page fixtures are clearly
 * labelled TEST DATA; the backend boundary is covered by unit tests.
 */

interface TtsWindow extends Window {
  __tts: { spoken: { text: string; lang: string }[]; cancelled: number };
  webkitSpeechRecognition: { startCount: number };
}

const FAKE_TTS_AUTOEND = `
  window.__tts = { spoken: [], cancelled: 0, last: null };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    speak(u) {
      window.__tts.spoken.push({ text: u.text, lang: u.lang });
      window.__tts.last = u;
      if (u.onstart) u.onstart();
      setTimeout(() => { if (window.__tts.last === u && u.onend) u.onend(); }, 20);
    },
    cancel() {
      window.__tts.cancelled += 1;
      const u = window.__tts.last;
      window.__tts.last = null;
      if (u && u.onend) u.onend();
    },
    getVoices() { return []; },
    pending: false, speaking: false, paused: false,
  } });
`;

const FAKE_RECOGNITION = `
  class FakeRecognition {
    constructor() { FakeRecognition.last = this; }
    start() { FakeRecognition.startCount = (FakeRecognition.startCount || 0) + 1; }
    stop() { if (this.onend) this.onend(); }
    abort() { if (this.onend) this.onend(); }
  }
  FakeRecognition.startCount = 0;
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
  Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: FakeRecognition });
`;

function sse(text: string, extra: Record<string, unknown> = {}) {
  return [
    { type: "conversation", conversationId: "p33-fixture-conv-1" },
    { type: "message", text, model: "fixture", viaFallback: false, cards: [], ...extra },
    { type: "done" },
  ]
    .map((e) => `data: ${JSON.stringify(e)}`)
    .join("\n\n")
    .concat("\n\n");
}

test("conversation mode speaks the actual assistant reply, then listens again after playback ends", async ({ page }) => {
  await page.addInitScript(FAKE_TTS_AUTOEND);
  await page.addInitScript(FAKE_RECOGNITION);
  await page.route("**/api/assistant", (r) =>
    r.fulfill({ status: 200, contentType: "text/event-stream", body: sse("Train select ho gayi. Passenger ka name bataiye.") }),
  );
  await page.goto("/chat");
  await page.getByTestId("conversation-mode").click();
  await page.getByLabel("Message").fill("3A select karo");
  await page.getByRole("button", { name: "Send" }).click();

  await page.waitForFunction(() => (window as unknown as TtsWindow).__tts.spoken.length > 0, undefined, { timeout: 10_000 });
  const spoken = await page.evaluate(() => (window as unknown as TtsWindow).__tts.spoken.map((s) => s.text));
  expect(spoken.join(" ")).toContain("Passenger ka name bataiye");

  // playback ended → conversation mode re-opens the mic automatically
  await page.waitForFunction(
    () => (window as unknown as TtsWindow).webkitSpeechRecognition.startCount >= 1,
    undefined,
    { timeout: 10_000 },
  );
});

const SELECTION = {
  trainNumber: "12951",
  trainName: "Morning Express",
  from: "LDH",
  to: "NDLS",
  journeyDate: "2026-10-12",
  classes: ["SL", "3A", "2A"],
  classCode: "3A",
  selectedAt: "2026-10-11T00:00:00.000Z",
};
const READY_TRUE = { ready: true, missingFields: [], blockers: [], warnings: [] };

test("review page shows authoritative train/stations/class/fare/availability/passengers; Proceed to IRCTC reaches handoff-ready", async ({ page }) => {
  let reviewed = false;
  let confirmed = false;
  const reviewState = () =>
    confirmed
      ? { version: 1, builtAt: "x", status: "confirmed", snapshot: "s" }
      : reviewed
        ? { version: 1, builtAt: "x", status: "awaiting_confirmation", snapshot: "s" }
        : null;
  await page.route("**/api/passenger*", async (route) => {
    if (route.request().method() !== "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          selection: SELECTION,
          passengers: [{ name: "Rahul Sharma", age: 28, gender: "male", berth: "lower" }],
          readiness: READY_TRUE,
          review: reviewState(),
          fare: { classCode: "3A", totalFare: 545, currency: "INR", retrievedAt: "2026-10-12T05:00:00.000Z", freshness: "fresh" },
          availability: { classes: [{ classCode: "3A", status: "RLWL2/WL2" }], retrievedAt: "2026-10-12T05:00:00.000Z", freshness: "fresh" },
          times: { departure: "06:15", arrival: "10:30" },
        }),
      });
    }
    const body = JSON.parse(route.request().postData() ?? "{}") as { action?: string };
    if (body.action === "review") {
      reviewed = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, selection: SELECTION, passengers: [], readiness: READY_TRUE, review: { version: 1, builtAt: "x", status: "awaiting_confirmation", snapshot: "s" } }) });
    }
    if (body.action === "confirm") {
      confirmed = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, selection: SELECTION, passengers: [], readiness: READY_TRUE, review: { version: 1, builtAt: "x", status: "confirmed", snapshot: "s" }, handoff: "IRCTC_HANDOFF_READY" }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/review?c=p33-fixture-conv-1");
  await expect(page.getByTestId("review-page")).toContainText("Morning Express");
  await expect(page.getByTestId("review-page")).toContainText("LDH → NDLS");
  await expect(page.getByTestId("review-page")).toContainText("Class 3A");
  await expect(page.getByTestId("review-fare")).toContainText("₹545");
  await expect(page.getByTestId("review-availability")).toContainText("RLWL2/WL2");
  await expect(page.getByTestId("review-page-pax-1")).toContainText("Rahul Sharma");
  await expect(page.getByTestId("review-pax-count")).toContainText("1 passenger");
  await expect(page.getByTestId("review-times")).toContainText("Dep 06:15 · Arr 10:30");
  await expect(page.getByTestId("review-status")).toContainText("Ready for review");
  await expect(page.getByTestId("proceed-irctc")).toBeEnabled();

  await page.getByTestId("proceed-irctc").click();
  await expect(page.getByTestId("handoff-ready")).toContainText("IRCTC_HANDOFF_READY");
  await expect(page.getByTestId("review-status")).toContainText("Preparation complete");
  await expect(page.getByTestId("handoff-ready")).toContainText("not enabled");
  expect(reviewed).toBe(true);
  expect(confirmed).toBe(true);
});

test("review page blocks Proceed while required fields are missing and names them", async ({ page }) => {
  await page.route("**/api/passenger*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        selection: SELECTION,
        passengers: [{ name: "Rahul Sharma" }],
        readiness: {
          ready: false,
          missingFields: ["passenger 1: age", "passenger 1: gender", "passenger 1: berth"],
          blockers: [{ code: "PASSENGER_INCOMPLETE", detail: "x" }],
          warnings: [],
        },
        review: null,
        fare: null,
        availability: null,
        times: null,
      }),
    }),
  );
  await page.goto("/review?c=p33-fixture-conv-1");
  await expect(page.getByTestId("review-missing")).toContainText("passenger 1: berth");
  await expect(page.getByTestId("review-fare")).toContainText("Fare verify nahi hui");
  await expect(page.getByTestId("review-status")).toContainText("Review incomplete");
  await expect(page.getByTestId("review-pax-count")).toContainText("1 passenger");
  await expect(page.getByTestId("review-times")).toHaveCount(0); // nothing invented when provider row has no times
  await expect(page.getByTestId("proceed-irctc")).toBeDisabled(); // blocked while required fields are missing
});
