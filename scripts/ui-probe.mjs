import { chromium } from "@playwright/test";

/** UI probe: renders chat with fixture cards + form state and screenshots it. */
const CARDS = [
  {
    trainNumber: "14612",
    trainName: "SVDK GCT EXP",
    from: "Ludhiana Junction (LDH)",
    to: "Lucknow (LKO)",
    departure: "11:10",
    arrival: "23:20",
    classes: ["SL", "3E", "3A", "2A"],
    journeyDate: "2026-10-12",
    source: "confirmtkt-v1",
    retrievedAt: new Date().toISOString(),
    providerTimestamp: null,
    availability: [
      { classCode: "SL", status: "RLWL50/WL25", asOf: null },
      { classCode: "3E", status: "RLWL3/WL3", asOf: null },
      { classCode: "3A", status: "RLWL4/WL4", asOf: null },
      { classCode: "2A", status: "RLWL2/WL2", asOf: null },
    ],
  },
  {
    trainNumber: "12238",
    trainName: "BEGUMPURA EXP",
    from: "Ludhiana Junction (LDH)",
    to: "New Delhi (NDLS)",
    departure: "18:40",
    arrival: "23:05",
    classes: ["SL", "3A", "2A"],
    journeyDate: "2026-10-12",
    source: "confirmtkt-v1",
    retrievedAt: new Date().toISOString(),
    providerTimestamp: null,
  },
];

const SELECTION = {
  trainNumber: "14612",
  trainName: "SVDK GCT EXP",
  from: "LDH",
  to: "LKO",
  journeyDate: "2026-10-12",
  classes: ["SL", "3E", "3A", "2A"],
  classCode: "2A",
  selectedAt: new Date().toISOString(),
};

const events = [
  { type: "conversation", conversationId: "probe-1" },
  { type: "message", text: "Do trains mili hain.", model: "probe", viaFallback: false, cards: CARDS, blocks: [] },
  { type: "passenger_form", selection: SELECTION, passengers: [{ name: "Rahul Sharma" }] },
  { type: "done" },
];
const body = events.map((e) => `data: ${JSON.stringify(e)}`).join("\n\n") + "\n\n";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.route("**/api/assistant", (route) =>
  route.fulfill({ status: 200, contentType: "text/event-stream", body }),
);
await page.goto(process.env.BASE + "/chat");
await page.getByLabel("Message").fill("LDH se LKO trains");
await page.getByRole("button", { name: "Send" }).click();
await page.getByTestId("train-cards").waitFor({ timeout: 10_000 });
await page.waitForTimeout(1200);
await page.getByTestId("train-cards").scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.getByTestId("train-cards").screenshot({ path: "scripts/ui-probe-cards.png" });
await page.screenshot({ path: "scripts/ui-probe-top.png" });
await page.getByTestId("passenger-form").scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
await page.screenshot({ path: "scripts/ui-probe-form.png" });
await browser.close();
console.log("probe done");
