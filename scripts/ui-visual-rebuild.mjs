/**
 * G3 visual verification for the UI/UX rebuild. Loads homepage, empty chat,
 * active chat with fixture train cards, and the review page at each target
 * viewport; asserts no horizontal overflow and saves screenshots for review.
 * Run against: npm run start -- -p 3100 (LLM creds cleared by webServer env
 * is not needed here — /api/assistant is stubbed via page.route).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:3100";
const OUT = "scripts/visual";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "360", width: 360, height: 800 },
  { name: "390", width: 390, height: 844 },
  { name: "412", width: 412, height: 915 },
  { name: "768", width: 768, height: 1024 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1440", width: 1440, height: 900 },
];

const sse = [
  { type: "conversation", conversationId: "visual-conv" },
  {
    type: "message",
    text: "Aapke liye do trains mili hain. Neeche timings, classes aur availability dekhiye.",
    model: "fixture",
    viaFallback: false,
    cards: [
      {
        trainNumber: "12014",
        trainName: "ASR SHTBDI (FIXTURE)",
        from: "Amritsar Jn (ASR)",
        to: "New Delhi (NDLS)",
        departure: "04:55",
        arrival: "11:02",
        classes: ["CC", "EC"],
        journeyDate: "2026-10-12",
        availability: [
          { classCode: "CC", status: "AVAILABLE-12" },
          { classCode: "EC", status: "RAC 5" },
        ],
        source: "confirmtkt-v1",
        retrievedAt: "2026-10-12T05:00:00.000Z",
        providerTimestamp: null,
      },
      {
        trainNumber: "12904",
        trainName: "GOLDEN TEMPLE (FIXTURE)",
        from: "Amritsar Jn (ASR)",
        to: "New Delhi (NDLS)",
        departure: "18:10",
        arrival: "—",
        classes: [],
        journeyDate: "2026-10-12",
      },
    ],
  },
  { type: "done" },
]
  .map((e) => `data: ${JSON.stringify(e)}`)
  .join("\n\n")
  .concat("\n\n");

const REVIEW = {
  selection: {
    trainNumber: "12951",
    trainName: "Morning Express",
    from: "LDH",
    to: "NDLS",
    journeyDate: "2026-10-20",
    classCode: "3A",
  },
  passengers: [{ name: "Rahul Sharma", age: 28, gender: "male", berth: "lower" }],
  readiness: { ready: true, missingFields: [], blockers: [] },
  review: null,
  fare: { classCode: "3A", totalFare: 545, currency: "INR", retrievedAt: "2026-10-12T05:00:00.000Z", freshness: "fresh" },
  availability: { classes: [{ classCode: "3A", status: "RLWL2/WL2" }], retrievedAt: "2026-10-12T05:00:00.000Z", freshness: "fresh" },
};

const results = [];

const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();

  const overflow = async (label) => {
    const ox = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    results.push({ vp: vp.name, label, overflow: ox });
  };

  // 1. Homepage
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/home-${vp.name}.png`, fullPage: vp.name === "360" });
  await overflow("home");

  // 2. Empty chat
  await page.goto(`${BASE}/chat`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/chat-empty-${vp.name}.png` });
  await overflow("chat-empty");

  // 3. Active chat with train cards (fixture SSE — no fake backend data in app)
  await page.route("**/api/assistant", (r) =>
    r.fulfill({ status: 200, contentType: "text/event-stream", body: sse }),
  );
  await page.getByLabel("Message").fill("Amritsar se Delhi trains");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByTestId("train-cards").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/chat-cards-${vp.name}.png`, fullPage: vp.name === "360" });
  await overflow("chat-cards");

  // 4. Review page (fixture GET — authoritative-state shape)
  await page.route("**/api/passenger?conversationId=**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(REVIEW) }),
  );
  await page.goto(`${BASE}/review?c=visual-conv`);
  await page.getByTestId("review-fare").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/review-${vp.name}.png`, fullPage: vp.name === "360" });
  await overflow("review");

  await ctx.close();
}
await browser.close();

let bad = 0;
for (const r of results) {
  const ok = r.overflow <= 0;
  if (!ok) bad++;
  console.log(`${ok ? "OK " : "BAD"} ${r.vp.padStart(4)} ${r.label.padEnd(12)} overflow=${r.overflow}`);
}
console.log(bad === 0 ? "G3 OVERFLOW: ALL PASS" : `G3 OVERFLOW: ${bad} FAILURES`);
process.exit(bad === 0 ? 0 : 1);
