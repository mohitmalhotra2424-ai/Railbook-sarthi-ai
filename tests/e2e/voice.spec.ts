import { expect, test } from "@playwright/test";

interface FakeRec {
  emitFinal(transcript: string): void;
  emitError(code: string): void;
  _end(): void;
}
interface VoiceTestWindow extends Window {
  webkitSpeechRecognition: { startCount: number; aborted: number; last: FakeRec };
  __tts: { spoken: { text: string; lang: string }[]; cancelled: number };
}

/**
 * Prompt 9 §8 — voice UI behaviour tests.
 *
 * AUTOMATED tests using TEST DOUBLES: the Web Speech APIs are stubbed via
 * addInitScript (a real headless browser has no working microphone/STT/TTS).
 * These verify UI wiring, states and safety only — they are NOT real
 * microphone, STT or TTS verification. The assistant itself still runs the
 * real backend (no LLM credentials in E2E → honest error path).
 */

const FAKE_RECOGNITION = `
  class FakeRecognition {
    constructor() { this.lang = ""; this.interimResults = false; this.continuous = false; FakeRecognition.last = this; }
    start() { FakeRecognition.startCount = (FakeRecognition.startCount || 0) + 1; }
    stop() { this._end(); }
    abort() { FakeRecognition.aborted = (FakeRecognition.aborted || 0) + 1; this._end(); }
    _end() { if (this.onend) this.onend(); }
    emitFinal(transcript) {
      const r = { isFinal: true, 0: { transcript } };
      const results = { 0: r, length: 1 };
      if (this.onresult) this.onresult({ resultIndex: 0, results });
    }
    emitError(code) { if (this.onerror) this.onerror({ error: code }); }
  }
  FakeRecognition.startCount = 0;
  FakeRecognition.aborted = 0;
  // Override BOTH constructor aliases — headless Chromium ships a native
  // (non-functional) SpeechRecognition that would otherwise take precedence.
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
  Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: FakeRecognition });
`;

const FAKE_TTS = `
  window.__tts = { spoken: [], cancelled: 0, last: null };
  // window.speechSynthesis is a READ-ONLY accessor in Chromium — a plain
  // assignment silently fails, so it must be redefined.
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    speak(u) {
      window.__tts.spoken.push({ text: u.text, lang: u.lang });
      window.__tts.last = u;
      if (u.onstart) u.onstart();
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

const FAKE_TTS_FAILING = `
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    speak() { throw new Error("no audio device (test double)"); },
    cancel() {},
    getVoices() { return []; },
  } });
`;

const NO_VOICE = `
  // redefine as undefined — these are accessors, plain delete/assign won't stick
  for (const k of ["SpeechRecognition", "webkitSpeechRecognition", "speechSynthesis"]) {
    Object.defineProperty(window, k, { configurable: true, value: undefined });
  }
`;

/** Fixture SSE stream (TEST DATA, clearly labelled — never live railway info). */
function sseFixture(messageIdText: string) {
  return [
    { type: "conversation", conversationId: "voice-fixture-conv" },
    {
      type: "message",
      text: messageIdText,
      model: "fixture-model",
      viaFallback: false,
      cards: [],
    },
  ]
    .map((e) => `data: ${JSON.stringify(e)}`)
    .join("\n\n")
    .concat("\n\n");
}

test("unsupported browser: no mic/speaker controls, text composer fully works", async ({ page }) => {
  await page.addInitScript(NO_VOICE);
  await page.goto("/chat");
  await expect(page.getByTestId("mic-button")).toHaveCount(0);
  await expect(page.getByTestId("speak-button")).toHaveCount(0);
  const composer = page.getByLabel("Message");
  await composer.fill("Ludhiana se Delhi ki trains");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("chat-message-user")).toBeVisible({ timeout: 15_000 });
});

test("mic tap starts recognition; Hindi transcript lands in the composer for review and is submitted as typed", async ({ page }) => {
  await page.addInitScript(FAKE_RECOGNITION);
  await page.goto("/chat");
  const mic = page.getByTestId("mic-button");
  await expect(mic).toBeVisible();

  await mic.click(); // permission flow begins only from this explicit user tap
  expect(await page.evaluate(() => (window as unknown as VoiceTestWindow).webkitSpeechRecognition.startCount)).toBe(1);
  await expect(page.getByTestId("voice-status")).toContainText("Sun raha hoon");

  // STT double returns a Hindi final transcript, then ends
  await page.evaluate(() => {
    const rec = (window as unknown as VoiceTestWindow).webkitSpeechRecognition.last;
    rec.emitFinal("ट्रेन का किराया कितना है");
    rec._end();
  });

  const composer = page.getByLabel("Message");
  await expect(composer).toHaveValue("ट्रेन का किराया कितना है"); // reviewable, NOT auto-sent
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("chat-message-user")).toContainText("ट्रेन का किराया");
  // real backend without LLM creds → honest error, never a fabricated answer
  await expect(page.getByTestId("chat-error")).toContainText("LLM_NOT_CONFIGURED", { timeout: 15_000 });
});

test("transcript can be corrected before submission — the edited text is what gets sent", async ({ page }) => {
  await page.addInitScript(FAKE_RECOGNITION);
  await page.goto("/chat");
  await page.getByTestId("mic-button").click();
  await page.evaluate(() => {
    const rec = (window as unknown as VoiceTestWindow).webkitSpeechRecognition.last;
    rec.emitFinal("amritsar delhi tren");
    rec._end();
  });
  const composer = page.getByLabel("Message");
  await expect(composer).toHaveValue("amritsar delhi tren");
  await composer.fill("Amritsar se Delhi ki trains batao"); // user corrects it
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("chat-message-user")).toContainText("Amritsar se Delhi ki trains batao");
  await expect(page.getByTestId("chat-message-user")).not.toContainText("tren");
});

test("permission denial shows an honest state; nothing is sent to the assistant", async ({ page }) => {
  await page.addInitScript(FAKE_RECOGNITION);
  await page.goto("/chat");
  await page.getByTestId("mic-button").click();
  await page.evaluate(() => {
    (window as unknown as VoiceTestWindow).webkitSpeechRecognition.last.emitError("not-allowed");
  });
  await expect(page.getByTestId("voice-status")).toContainText("Microphone permission");
  await expect(page.getByLabel("Message")).toHaveValue(""); // nothing fabricated or auto-sent
  await expect(page.getByTestId("chat-message-user")).toHaveCount(0);
});

test("recognition failure (network) offers text as an alternative; cancel aborts recording", async ({ page }) => {
  await page.addInitScript(FAKE_RECOGNITION);
  await page.goto("/chat");
  const mic = page.getByTestId("mic-button");

  // network error state
  await mic.click();
  await page.evaluate(() => {
    (window as unknown as VoiceTestWindow).webkitSpeechRecognition.last.emitError("network");
  });
  await expect(page.getByTestId("voice-status")).toContainText("text se type kar lein");

  // cancel path
  await mic.click();
  await mic.click(); // second tap cancels the active recording
  expect(await page.evaluate(() => (window as unknown as VoiceTestWindow).webkitSpeechRecognition.aborted)).toBeGreaterThanOrEqual(1);
});

test("speaker plays the ACTUAL assistant reply without markdown; stop halts playback (TTS double)", async ({ page }) => {
  await page.addInitScript(FAKE_TTS);
  await page.route("**/api/assistant", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: sseFixture("नमस्ते! *12014* — ASR SHTBDI, dep `04:55` (FIXTURE reply)"),
    }),
  );
  await page.goto("/chat");
  await page.getByLabel("Message").fill("hello (fixture)");
  await page.getByRole("button", { name: "Send" }).click();

  const speakBtn = page.getByTestId("speak-button");
  await expect(speakBtn).toBeVisible({ timeout: 15_000 });
  await speakBtn.click();

  const spoken = await page.evaluate(() => (window as unknown as VoiceTestWindow).__tts.spoken);
  expect(spoken).toHaveLength(1);
  expect(spoken[0].lang).toBe("hi-IN"); // Devanagari detected
  expect(spoken[0].text).not.toContain("*"); // markdown never read aloud
  expect(spoken[0].text).not.toContain("`");
  expect(spoken[0].text).toContain("12014"); // the ACTUAL reply content

  // stop control
  await expect(speakBtn).toContainText("Rok dein");
  await speakBtn.click();
  expect(await page.evaluate(() => (window as unknown as VoiceTestWindow).__tts.cancelled)).toBeGreaterThanOrEqual(1);
  await expect(speakBtn).toContainText("Suno");
});

test("TTS failure is handled gracefully — readable error, reply stays on screen", async ({ page }) => {
  await page.addInitScript(FAKE_TTS_FAILING);
  await page.route("**/api/assistant", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: sseFixture("Fixture reply for TTS failure test."),
    }),
  );
  await page.goto("/chat");
  await page.getByLabel("Message").fill("hello (fixture)");
  await page.getByRole("button", { name: "Send" }).click();
  const speakBtn = page.getByTestId("speak-button");
  await expect(speakBtn).toBeVisible({ timeout: 15_000 });
  await speakBtn.click();
  await expect(page.getByTestId("chat-message-assistant")).toContainText("Audio playback fail ho gaya");
  await expect(page.getByTestId("chat-message-assistant")).toContainText("Fixture reply for TTS failure test.");
});

test("duplicate submission is prevented while a request is in flight", async ({ page }) => {
  await page.addInitScript(FAKE_TTS);
  await page.route("**/api/assistant", async (route) => {
    await new Promise((r) => setTimeout(r, 700)); // keep the request in flight
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: sseFixture("Fixture reply."),
    });
  });
  await page.goto("/chat");
  await page.getByLabel("Message").fill("duplicate test (fixture)");
  const send = page.getByRole("button", { name: /Send|Sending/ });
  await send.click();
  await expect(send).toBeDisabled(); // progress state blocks a second submit
  await send.click({ force: true }).catch(() => undefined);
  await expect(page.getByTestId("chat-message-user")).toHaveCount(1, { timeout: 15_000 });
});

test("conversation mode toggle exposes its state (tap-to-talk remains the default)", async ({ page }) => {
  await page.addInitScript(FAKE_RECOGNITION + FAKE_TTS);
  await page.goto("/chat");
  const toggle = page.getByTestId("conversation-mode");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toContainText("ON");
  // language toggle flips STT language label
  const lang = page.getByTestId("voice-lang");
  await expect(lang).toContainText("हिंदी");
  await lang.click();
  await expect(lang).toContainText("EN");
});
