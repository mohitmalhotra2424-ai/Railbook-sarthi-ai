import { expect, test } from "@playwright/test";

/**
 * Prompt 13 — premium home: explains the product, one CTA into chat, a
 * working composer card that hands off to the REAL chat architecture.
 */
test("homepage explains the product with CTA, features and honesty promises at 360px", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Your Journey,");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Simplified.");
  await expect(
    page.getByText("Ask anything about Indian Railways in Hindi, Hinglish or English"),
  ).toBeVisible();

  const cta = page.getByTestId("start-chatting");
  await expect(cta).toBeVisible();
  const box = await cta.boundingBox();
  expect(box && box.height).toBeGreaterThanOrEqual(44);

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

  await expect(page.getByText("Source on every answer")).toBeVisible();
  await expect(page.getByText("No invented data")).toBeVisible();
});

test("CTA opens chat; home composer + suggestions start real chat turns", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-chatting").click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByLabel("Message")).toBeVisible();

  // composer card handoff
  await page.goto("/");
  await page.getByLabel("Ask RailSaarthi").fill("Amritsar se Delhi ki trains");
  await page.getByLabel("Send to assistant").click();
  await page.waitForURL((url) => url.pathname === "/chat" && url.search === "");
  await expect(page.getByTestId("chat-message-user")).toContainText("Amritsar se Delhi ki trains", {
    timeout: 15_000,
  });

  // suggestion chip handoff
  await page.goto("/");
  await page.getByTestId("suggestion").first().click();
  await page.waitForURL((url) => url.pathname === "/chat" && url.search === "");
  await expect(page.getByTestId("chat-message-user")).toBeVisible({ timeout: 15_000 });
});
