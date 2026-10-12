import { expect, test } from "@playwright/test";

/**
 * Prompt 45 — auto-play TTS (no "Suno" tap needed). TEST DOUBLES only:
 * fake /api/voice/speech + fake Audio/speechSynthesis. Verifies the new
 * default (every assistant reply speaks automatically) and the persisted
 * off-toggle. Real audio behaviour is covered by the live voice checks.
 */

interface AutoSpeakWindow extends Window {
  __tts: { spoken: { text: string }[] };
  __audio: { played: boolean }[];
}

const FAKE_TTS = `
  window.__tts = { spoken: [], last: null };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    speak(u) { window.__tts.spoken.push({ text: u.text }); window.__tts.last = u; if (u.onstart) u.onstart(); },
    cancel() { const u = window.__tts.last; window.__tts.last = null; if (u && u.onend) u.onend(); },
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
    { type: "conversation", conversationId: "p45-autospeak-conv" },
    { type: "message", text, model: "fixture", viaFallback: false, cards: [] },
    { type: "done" },
  ]
    .map((e) => `data: ${JSON.stringify(e)}`)
    .join("\n\n")
    .concat("\n\n");
}

test("Prompt 45: assistant replies play automatically WITHOUT any Suno tap; toggle off stops autoplay and persists", async ({ page }) => {
  await page.addInitScript(FAKE_TTS);
  await page.addInitScript(FAKE_AUDIO);
  await page.route("**/api/voice/speech", (r) =>
    r.fulfill({ status: 200, contentType: "audio/wav", body: WAV }),
  );
  await page.route("**/api/assistant", (r) =>
    r.fulfill({ status: 200, contentType: "text/event-stream", body: sse("Aapki train 12951 subah chalegi.") }),
  );

  await page.goto("/chat");
  await page.getByLabel("Message").fill("train kab hai");
  await page.getByRole("button", { name: "Send" }).click();

  // 1) Autoplay: server audio starts with NO click on the speaker button
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as AutoSpeakWindow).__audio.filter((a) => a.played).length), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // 2) Toggle off persists; the next reply does not auto-play
  const toggle = page.getByTestId("autospeak-toggle");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toContainText("Off");
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("railsaarthi.autospeak")))
    .toBe("off");
  const played = await page.evaluate(() => (window as unknown as AutoSpeakWindow).__audio.filter((a) => a.played).length);
  await page.getByLabel("Message").fill("aur batao");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("chat-message-assistant")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Send" })).toHaveAttribute("aria-busy", "false");
  expect(await page.evaluate(() => (window as unknown as AutoSpeakWindow).__audio.filter((a) => a.played).length)).toBe(played);
  await page.reload();
  await expect(page.getByTestId("autospeak-toggle")).toContainText("Off");
});
