import { expect, test } from "@playwright/test";

/**
 * UI/UX milestone — focused interaction & responsive checks.
 * Fixture SSE is clearly labelled TEST FIXTURE; never live data.
 */

const sseWithCards = [
  { type: "conversation", conversationId: "fixture-conv" },
  {
    type: "message",
    text: "Ye rahi trains (TEST FIXTURE — demo data, live nahi).",
    model: "fixture-model",
    viaFallback: false,
    cards: [
      {
        trainNumber: "12014",
        trainName: "ASR SHTBDI (FIXTURE)",
        from: "Amritsar Jn (ASR)",
        to: "New Delhi (NDLS)",
        departure: "05:55",
        arrival: "11:02",
        classes: ["CC", "EC"],
        journeyDate: "2026-10-12",
      },
    ],
  },
].map((e) => `data: ${JSON.stringify(e)}`).join("\n\n").concat("\n\n");

test("card actions: Check Availability shows loading + blocks duplicates, Check Fare exists", async ({
  page,
}) => {
  let first = true;
  await page.route("**/api/assistant", async (r) => {
    if (!first) {
      // the follow-up turn takes its time so loading states are observable
      await new Promise((res) => setTimeout(res, 1500));
    }
    first = false;
    await r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: sseWithCards });
  });
  await page.goto("/chat");
  await page.getByLabel("Message").fill("fixture trains");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByTestId("train-cards").waitFor({ timeout: 15_000 });

  const card = page.getByTestId("train-cards").first();
  const avail = card.getByRole("button", { name: /Check Availability|Checking availability/ });
  const fare = card.getByRole("button", { name: /Check Fare|Checking fare/ });
  await expect(avail).toBeEnabled();
  await expect(fare).toBeEnabled();

  await avail.click();
  // loading label + duplicate protection on BOTH actions of this card
  await expect(page.getByTestId("card-availability-loading")).toBeDisabled();
  await expect(fare).toBeDisabled();
  // the follow-up went through the existing chat pipeline exactly once
  await expect(page.getByTestId("chat-message-user")).toHaveCount(2, { timeout: 10_000 });
  await expect(page.getByTestId("chat-message-user").nth(1)).toContainText("seat availability");
});

test("retryable backend error offers Retry which resends exactly one more turn", async ({ page }) => {
  await page.route("**/api/assistant", (r) =>
    r.fulfill({ status: 500, body: "boom" }),
  );
  await page.goto("/chat");
  await page.getByLabel("Message").fill("Ludhiana se Delhi");
  await page.getByRole("button", { name: "Send" }).click();
  const retry = page.getByTestId("retry-button");
  await expect(retry).toBeVisible({ timeout: 15_000 });
  await retry.click();
  // original + retried user message, no more
  await expect(page.getByTestId("chat-message-user")).toHaveCount(2, { timeout: 10_000 });
});

test("no horizontal overflow on home and chat at the active viewport", async ({ page }) => {
  for (const path of ["/", "/chat"]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(0);
  }
});

test("train details exposes accessible tabs with panel wiring", async ({ page }) => {
  await page.goto("/trains/12014");
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(4);
  const overview = page.getByRole("tab", { name: "Overview" });
  await expect(overview).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel");
  await expect(panel).toBeVisible();
  await page.getByRole("tab", { name: "Route" }).click();
  await expect(page.getByRole("tab", { name: "Route" })).toHaveAttribute("aria-selected", "true");
});

test("class chips: tap asks the assistant to select train + that class, keeps association", async ({
  page,
}) => {
  await page.route("**/api/assistant", (r) =>
    r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: sseWithCards }),
  );
  await page.goto("/chat");
  await page.getByLabel("Message").fill("fixture trains");
  await page.getByRole("button", { name: "Send" }).click();
  const card = page.getByTestId("train-cards").first();
  await card.waitFor({ timeout: 15_000 });

  const cc = card.getByTestId("class-chip-CC");
  await expect(cc).toHaveAttribute("aria-pressed", "false");
  await cc.click();

  // selected state + the follow-up turn selects THIS train + class
  await expect(cc).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("chat-message-user")).toHaveCount(2, { timeout: 10_000 });
  await expect(page.getByTestId("chat-message-user").nth(1)).toContainText("CC select karo");

  // chips with provider availability show dot+label text (fixture 1st card has none,
  // but availability chips appear in the result block tables — verify card raw line absent)
  await expect(card.getByText("CC:", { exact: false })).toHaveCount(0);
});
