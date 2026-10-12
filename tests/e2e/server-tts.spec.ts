import { expect, test } from "@playwright/test";

/**
 * Prompt 34 addendum — client wiring for server-side TTS. TEST DOUBLES only:
 * a fake /api/voice/speech and a fake HTMLAudioElement (headless has no real
 * audio output). Verifies: server audio is played for the actual assistant
 * reply; 503 falls back to browser speechSynthesis; an in-flight playback is
 * cancelled by stop and cannot play afterwards (no stale audio).
 */

interface TtsTestWindow extends Window {
  __tts: { spoken: { text: string }[]; cancelled: number };
  __audio: { played: boolean; end: () => void }[];
}

const FAKE_TTS = `
  window.__tts = { spoken: [], cancelled: 0, last: null };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    speak(u) { window.__tts.spoken.push({ text: u.text }); window.__tts.last = u; if (u.onstart) u.onstart(); },
    cancel() { window.__tts.cancelled += 1; const u = window.__tts.last; window.__tts.last = null; if (u && u.onend) u.onend(); },
    getVoices() { return []; },
    pending: false, speaking: false, paused: false,
  } });
`;

const FAKE_AUDIO = `
  window.__audio = [];
  class FakeAudio {
    constructor(src) { this.src = src; this.played = false; window.__audio.push(this); }
    play() { this.played = true; return Promise.resolve(); }
    pause() {}
    end() { if (this.onended) this.onended(); }
  }
  Object.defineProperty(window, "Audio", { configurable: true, value: FakeAudio });
`;

const WAV = Buffer.from("UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=", "base64");

function sse(text: string) {
  return [
    { type: "conversation", conversationId: "tts-fixture-conv" },
    { type: "message", text, model: "fixture", viaFallback: false, cards: [] },
    { type: "done" },
  ]
    .map((e) => `data: ${JSON.stringify(e)}`)
    .join("\n\n")
    .concat("\n\n");
}

async function openChat(page: import("@playwright/test").Page, text: string) {
  // Prompt 45: autoplay is ON by default — this spec verifies the explicit
  // speaker-button (replay/stop) semantics, so pin autoplay off here; the
  // default-on behaviour has its own spec (auto-speak.spec.ts).
  await page.addInitScript(() => {
    try { localStorage.setItem("railsaarthi.autospeak", "off"); } catch { /* ignore */ }
  });
  await page.route("**/api/assistant", (r) =>
    r.fulfill({ status: 200, contentType: "text/event-stream", body: sse(text) }),
  );
  await page.goto("/chat");
  await page.getByLabel("Message").fill("test");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByTestId("speak-button").waitFor({ timeout: 10_000 });
}

test("server TTS audio is played for the actual assistant reply; end clears state", async ({ page }) => {
  await page.addInitScript(FAKE_AUDIO);
  await page.addInitScript(FAKE_TTS);
  let posts = 0;
  await page.route("**/api/voice/speech*", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: true }) });
    }
    posts += 1;
    const body = JSON.parse(route.request().postData() ?? "{}") as { text?: string };
    expect(body.text).toContain("Namaste, reply taiyaar hai");
    return route.fulfill({ status: 200, contentType: "audio/wav", body: WAV });
  });
  await openChat(page, "Namaste, reply taiyaar hai.");

  await page.getByTestId("speak-button").click();
  await page.waitForFunction(() => (window as unknown as TtsTestWindow).__audio.length > 0, undefined, { timeout: 10_000 });
  const played = await page.evaluate(() => (window as unknown as TtsTestWindow).__audio[0].played);
  expect(played).toBe(true);
  expect(posts).toBe(1); // no duplicate TTS request
  // browser fallback NOT used when server audio plays
  expect(await page.evaluate(() => (window as unknown as TtsTestWindow).__tts.spoken.length)).toBe(0);

  // playback ends → button returns to "Suno"
  await page.evaluate(() => (window as unknown as TtsTestWindow).__audio[0].end());
  await expect(page.getByTestId("speak-button")).toContainText("Suno", { timeout: 5_000 });
});

test("503 from server TTS falls back to browser speechSynthesis", async ({ page }) => {
  await page.addInitScript(FAKE_TTS);
  await page.route("**/api/voice/speech*", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, code: "not_configured" }) }),
  );
  await openChat(page, "Fallback check.");
  await page.getByTestId("speak-button").click();
  await page.waitForFunction(() => (window as unknown as TtsTestWindow).__tts.spoken.length > 0, undefined, { timeout: 10_000 });
  const spoken = await page.evaluate(() => (window as unknown as TtsTestWindow).__tts.spoken.map((s) => s.text).join(" "));
  expect(spoken).toContain("Fallback check");
});

test("stop cancels an in-flight server TTS request — obsolete audio never plays", async ({ page }) => {
  await page.addInitScript(FAKE_AUDIO);
  await page.route("**/api/voice/speech*", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: true }) });
    }
    await new Promise((r) => setTimeout(r, 300)); // slow upstream
    return route.fulfill({ status: 200, contentType: "audio/wav", body: WAV });
  });
  await openChat(page, "Slow audio turn.");
  await page.getByTestId("speak-button").click(); // starts fetch (button shows Stop)
  await page.getByTestId("speak-button").click(); // barge-in stop while in flight
  await page.waitForTimeout(700);
  const playedCount = await page.evaluate(
    () => (window as unknown as TtsTestWindow).__audio.filter((a) => a.played).length,
  );
  expect(playedCount).toBe(0); // obsolete audio suppressed
});
