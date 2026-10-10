import { expect, test } from "@playwright/test";

/**
 * Prompt 12 — the homepage explains the product in seconds and routes users
 * into the single chat experience (no duplicated inputs on home).
 */
test("homepage explains the product, offers one CTA and honesty promises at 360px", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Your Journey, Simplified.");
  await expect(
    page.getByText("Ask anything about Indian Railways in Hindi, Hinglish or English"),
  ).toBeVisible();

  // one prominent CTA into chat
  const cta = page.getByTestId("start-chatting");
  await expect(cta).toBeVisible();
  await expect(cta).toBeInViewport();
  const box = await cta.boundingBox();
  expect(box && box.height).toBeGreaterThanOrEqual(44);

  // the six capability features are named plainly
  for (const f of [
    "Find Trains",
    "Timings & Routes",
    "Fare & Classes",
    "Seat Availability",
    "Live Train Status",
    "PNR Status",
  ]) {
    await expect(page.getByText(f, { exact: true })).toBeVisible();
  }

  // honesty promises remain visible
  await expect(page.getByText("Source on every answer")).toBeVisible();
  await expect(page.getByText("No invented data")).toBeVisible();

  // no duplicated chat input on the homepage
  await expect(page.getByLabel("Message")).toHaveCount(0);
  await expect(page.getByLabel("Ask RailSaarthi")).toHaveCount(0);
});

test("CTA opens chat; example questions start a real chat turn", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-chatting").click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByLabel("Message")).toBeVisible();

  await page.goto("/");
  await page.getByTestId("suggestion").first().click();
  await page.waitForURL((url) => url.pathname === "/chat" && url.search === "");
  // the handoff performs a REAL turn through the existing architecture
  await expect(page.getByTestId("chat-message-user")).toContainText("Ludhiana se Delhi ki trains", {
    timeout: 15_000,
  });
});
