import { expect, test } from "@playwright/test";

/**
 * PROMPT 35 — natural conversational voice layer. TEST DOUBLES only (fake
 * /api/voice/speech, fake speechSynthesis, fake HTMLAudioElement — headless
 * has no real audio). Verifies: browser-fallback playback is chunked into
 * sentences and played in order without duplicates; stopping mid-chain
 * discards the remaining chunks; typing/sending a message stops playback
 * promptly (text barge-in) and the new turn still goes through.
 */

interface VoiceTestWindow extends Window {
  __tts: {
    spoken: string[];
    last: { text: string; onstart?: () => void; onend?: () => void; onerror?: () => void } | null;
    cancelled: number;
  };
  __audio: { played: boolean; paused: boolean; end: () => void }[];
}

/** speechSynthesis fake: each utterance ends automatically (chained playback). */
const FAKE_TTS_AUTO = `
  window.__tts = { spoken: [], last: null, cancelled: 0 };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    speak(u) {
      window.__tts.spoken.push(u.text);
      window.__tts.last = u;
      if (u.onstart) u.onstart();
      setTimeout(function () { if (u.onend) u.onend(); }, 5);
    },
    cancel() { window.__tts.cancelled += 1; },
    getVoices() { return []; },
    pending: false, speaking: false, paused: false,
  } });
`;

/** speechSynthesis fake: utterances end ONLY when the test triggers onend. */
const FAKE_TTS_MANUAL = `
  window.__tts = { spoken: [], last: null, cancelled: 0 };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    speak(u) { window.__tts.spoken.push(u.text); window.__tts.last = u; if (u.onstart) u.onstart(); },
    cancel() { window.__tts.cancelled += 1; },
    getVoices() { return []; },
    pending: false, speaking: false, paused: false,
  } });
`;

/** Audio fake that records pause() (barge-in must pause the element). */
const FAKE_AUDIO_P = `
  window.__audio = [];
  class FakeAudio {
    constructor(src) { this.src = src; this.played = false; this.paused = false; window.__audio.push(this); }
    play() { this.played = true; return Promise.resolve(); }
    pause() { this.paused = true; }
    end() { if (this.onended) this.onended(); }
  }
  Object.defineProperty(window, "Audio", { configurable: true, value: FakeAudio });
`;

const WAV = Buffer.from("UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=", "base64");

function sse(text: string) {
  return [
    { type: "conversation", conversationId: "voice-natural-conv" },
    { type: "message", text, model: "fixture", viaFallback: false, cards: [] },
    { type: "done" },
  ]
    .map((e) => `data: ${JSON.stringify(e)}`)
    .join("\n\n")
    .concat("\n\n");
}

/** ~155 chars per sentence, 3 sentences → forces >1 chunk under maxLen 220. */
function longReply() {
  const s = (n: number) => `Vakya ${n}: ` + "shabd ".repeat(24) + ".";
  return [s(1), s(2), s(3)].join(" ");
}

async function openChat(page: import("@playwright/test").Page, text: string) {
  await page.route("**/api/assistant", (r) =>
    r.fulfill({ status: 200, contentType: "text/event-stream", body: sse(text) }),
  );
  await page.goto("/chat");
  await page.getByLabel("Message").fill("test");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByTestId("speak-button").waitFor({ timeout: 10_000 });
}

test("browser fallback speaks sentence chunks in order, once each, nothing lost", async ({ page }) => {
  await page.addInitScript(FAKE_TTS_AUTO);
  await page.route("**/api/voice/speech*", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, code: "not_configured" }) }),
  );
  await openChat(page, longReply());
  await page.getByTestId("speak-button").click();
  await page.waitForFunction(() => (window as unknown as VoiceTestWindow).__tts.spoken.length === 3, undefined, { timeout: 10_000 });

  const spoken = await page.evaluate(() => (window as unknown as VoiceTestWindow).__tts.spoken);
  expect(spoken[0]).toContain("Vakya 1");
  expect(spoken[1]).toContain("Vakya 2");
  expect(spoken[2]).toContain("Vakya 3");
  // every sentence exactly once — no duplicates, no dropped content
  const joined = spoken.join(" ");
  for (const n of [1, 2, 3]) {
    expect(joined.match(new RegExp(`Vakya ${n}:`, "g"))).toHaveLength(1);
  }
  expect(joined).toContain("shabd"); // content preserved end-to-end
  await expect(page.getByTestId("speak-button")).toContainText("Suno", { timeout: 5_000 });
});

test("stop mid-chain discards remaining chunks — no orphaned audio", async ({ page }) => {
  await page.addInitScript(FAKE_TTS_MANUAL);
  await page.route("**/api/voice/speech*", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, code: "not_configured" }) }),
  );
  await openChat(page, longReply());
  await page.getByTestId("speak-button").click();
  await page.waitForFunction(() => (window as unknown as VoiceTestWindow).__tts.spoken.length === 1, undefined, { timeout: 10_000 });

  // advance the chain manually: chunk 1 ends → chunk 2 starts
  await page.evaluate(() => {
    const w = window as unknown as VoiceTestWindow;
    if (w.__tts.last?.onend) w.__tts.last.onend();
  });
  await page.waitForFunction(() => (window as unknown as VoiceTestWindow).__tts.spoken.length === 2, undefined, { timeout: 10_000 });

  // barge-in stop while chunk 2 is "playing"
  await expect(page.getByTestId("speak-button")).toContainText("Rok dein");
  await page.getByTestId("speak-button").click();

  // even if the obsolete utterance reports completion, chunk 3 must never be spoken
  await page.evaluate(() => {
    const w = window as unknown as VoiceTestWindow;
    if (w.__tts.last?.onend) w.__tts.last.onend();
  });
  await page.waitForTimeout(300);
  const spoken = await page.evaluate(() => (window as unknown as VoiceTestWindow).__tts.spoken);
  expect(spoken).toHaveLength(2); // chunk 3 discarded by the generation guard
  expect(spoken.some((t) => t.includes("Vakya 3"))).toBe(false);
});

test("sending a message stops in-flight server audio promptly (text barge-in)", async ({ page }) => {
  await page.addInitScript(FAKE_AUDIO_P);
  await page.addInitScript(FAKE_TTS_AUTO);
  await page.route("**/api/voice/speech*", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: true }) });
    }
    return route.fulfill({ status: 200, contentType: "audio/wav", body: WAV });
  });
  await openChat(page, "Chalta hua reply.");
  await page.getByTestId("speak-button").click();
  await page.waitForFunction(
    () => (window as unknown as VoiceTestWindow).__audio.length > 0 && (window as unknown as VoiceTestWindow).__audio[0].played,
    undefined,
    { timeout: 10_000 },
  );

  // user types and sends while the reply is still playing
  await page.getByLabel("Message").fill("doosra sawal");
  await page.getByRole("button", { name: "Send" }).click();

  await page.waitForFunction(() => (window as unknown as VoiceTestWindow).__audio[0].paused === true, undefined, { timeout: 10_000 });
  // obsolete element cannot resurrect playback state after stop
  await page.evaluate(() => (window as unknown as VoiceTestWindow).__audio[0].end());
  await expect(page.getByTestId("speak-button").first()).toContainText("Suno", { timeout: 5_000 });
  // the new turn went through normally
  await expect(page.getByTestId("speak-button")).toHaveCount(2, { timeout: 10_000 });
});
