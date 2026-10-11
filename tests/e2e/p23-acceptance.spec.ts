import { expect, test } from "@playwright/test";

/**
 * PROMPT 23 — voice-to-UI consistency & UI acceptance.
 * TEST DOUBLES for the Web Speech APIs (headless has no mic/STT/TTS):
 * these verify integration logic only — real speech hardware/services
 * remain BLOCKED in this environment and are reported as such.
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
      if (this.onresult) this.onresult({ resultIndex: 0, results: { 0: r, length: 1 } });
    }
  }
  FakeRecognition.startCount = 0;
  FakeRecognition.aborted = 0;
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
  Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: FakeRecognition });
`;

test("voice corrections land in the composer for review; one tap of Send = exactly one assistant request", async ({ page }) => {
  await page.addInitScript(FAKE_RECOGNITION);
  let requests = 0;
  await page.route("**/api/assistant", async (route) => {
    requests += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        'data: {"type":"conversation","conversationId":"p23-conv"}\n\n' +
        'data: {"type":"message","text":"Fixture reply (test data).","model":"fixture","viaFallback":false,"cards":[]}\n\n' +
        'data: {"type":"done"}\n\n',
    });
  });

  await page.goto("/chat");
  await page.getByTestId("mic-button").click();
  // Simulated spoken correction, in two final chunks (never auto-submitted)
  await page.evaluate(() => {
    const w = window as unknown as { webkitSpeechRecognition: { last: { emitFinal: (t: string) => void } } };
    w.webkitSpeechRecognition.last.emitFinal("Nahi, Delhi nahi.");
    w.webkitSpeechRecognition.last.emitFinal("Amritsar jaana hai.");
  });

  // Speech is ONLY in the composer for review — no request went out yet
  const input = page.getByLabel("Message");
  await expect(input).toHaveValue(/Nahi, Delhi nahi\. Amritsar jaana hai\./);
  expect(requests).toBe(0);

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("chat-message-user")).toContainText("Amritsar jaana hai");
  expect(requests).toBe(1); // one submission, one assistant request
});

const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 1440, height: 900 },
];
for (const vp of VIEWPORTS) {
  test(`no console/page errors and no horizontal overflow on home+chat @${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    const problems: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`console: ${m.text()}`);
    });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

    await page.goto("/", { waitUntil: "load" });
    await expect(page.getByTestId("start-chatting")).toBeVisible();
    const owHome = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(owHome).toBeLessThanOrEqual(1);

    await page.goto("/chat", { waitUntil: "load" });
    await expect(page.getByLabel("Message")).toBeVisible();
    const owChat = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(owChat).toBeLessThanOrEqual(1);

    expect(problems).toEqual([]);
  });
}
