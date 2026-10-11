import { chromium } from "@playwright/test";

/** UI probe: tap "Select train" → passenger form appears (auto-scroll), class pending. */
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
      { classCode: "2A", status: "RLWL2/WL2", asOf: null },
    ],
  },
];

const cardsSse = [
  { type: "conversation", conversationId: "probe-2" },
  { type: "message", text: "Train mili.", model: "probe", viaFallback: false, cards: CARDS, blocks: [] },
  { type: "done" },
];
const formSse = [
  { type: "conversation", conversationId: "probe-2" },
  {
    type: "passenger_form",
    selection: { trainNumber: "14612", trainName: "SVDK GCT EXP", from: "LDH", to: "LKO", journeyDate: "2026-10-12", classes: ["SL", "3E", "3A", "2A"], selectedAt: new Date().toISOString() },
    passengers: [],
  },
  { type: "message", text: "Train select ho gayi. Class chuniye.", model: "probe", viaFallback: false, cards: [], blocks: [] },
  { type: "done" },
];
const toBody = (evs) => evs.map((e) => `data: ${JSON.stringify(e)}`).join("\n\n") + "\n\n";

let calls = 0;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.route("**/api/assistant", (route) => {
  calls += 1;
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: toBody(calls === 1 ? cardsSse : formSse),
  });
});
await page.goto(process.env.BASE + "/chat");
await page.getByLabel("Message").fill("LDH se LKO");
await page.getByRole("button", { name: "Send" }).click();
await page.getByTestId("train-cards").waitFor({ timeout: 10_000 });
// No form yet — it must NOT be sticky/always-on.
if ((await page.getByTestId("passenger-form").count()) !== 0) throw new Error("form visible before selection!");
// Tap Select train → form appears.
await page.getByTestId("card-select-train").first().click();
await page.getByTestId("passenger-form").waitFor({ timeout: 10_000 });
await page.waitForTimeout(900);
await page.screenshot({ path: "scripts/ui-probe-form-open.png" });
await browser.close();
console.log("probe2 done — form appeared only after select");
