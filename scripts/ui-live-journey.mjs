/**
 * PROMPT 16 §2 — real-world acceptance: homepage → suggestion → live search →
 * contextual follow-up → New Chat reset, in a REAL browser against a server
 * with the real LLM + providers. No fixtures.
 *
 *   node scripts/ui-live-journey.mjs   (server with LLM+providers on :3100)
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "LIVE PASS" : "LIVE FAIL"} — ${name}${detail ? ` | ${detail}` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

// 1) homepage → suggested question → chat
const t0 = Date.now();
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.getByTestId("suggestion").first().click(); // "Kal Amritsar se Delhi ki trains dikhao"
await page.waitForURL((u) => u.pathname === "/chat", { timeout: 10_000 });
check("J1 suggestion handoff into chat", true);

// 2) live search renders real train cards
await page.getByTestId("train-cards").waitFor({ timeout: 120_000 });
const cardsText = await page.getByTestId("train-cards").first().innerText();
const nums = [...cardsText.matchAll(/\b(\d{5})\b/g)].map((m) => m[1]);
check("J2 live search renders real cards", nums.length > 0, `${nums.slice(0, 2).join(",")} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// 3) contextual follow-up via composer
await page.getByLabel("Message").fill("Inmein sabse jaldi kaunsi pahunchegi?");
await page.getByRole("button", { name: "Send" }).click();
const cardText = await page.getByTestId("train-cards").first().innerText();
const nameTokens = [...cardText.matchAll(/([A-Z]{3,}(?: [A-Z]{2,})*)/g)].map((m) => m[1]).filter((t) => t.length > 3);
let lastText = "";
for (let i = 0; i < 40; i++) {
  lastText = await page.getByTestId("chat-message-assistant").last().innerText();
  if (nums.some((n) => lastText.includes(n)) || nameTokens.some((t) => lastText.includes(t))) break;
  await page.waitForTimeout(3000);
}
check("J3 follow-up resolved from context", nums.some((n) => lastText.includes(n)) || nameTokens.some((t) => lastText.includes(t)), "");

// 4) provenance visible (source + freshness or honest note)
const bodyText = await page.locator("main").innerText();
const provenance = /Source:|fresh|Provider timestamp/i.test(bodyText);
check("J4 provenance/freshness surfaced", provenance);

// 5) New Chat resets without corrupting anything
await page.getByTestId("new-chat").click(); // arms confirm
await page.waitForTimeout(300);
await page.getByTestId("new-chat").click(); // confirms
await page.getByText(/Main RailSaarthi/i).waitFor({ timeout: 10_000 });
check("J5 New Chat resets to welcome", (await page.getByTestId("chat-message-user").count()) === 0);

await browser.close();
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} live UI journey checks passed.`);
process.exit(fails.length ? 1 : 0);
