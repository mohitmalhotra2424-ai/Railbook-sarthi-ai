import { expect, test } from "@playwright/test";

/**
 * Premium home (UI/UX rebuild): explains the product with a conversation-first
 * hero, one CTA into chat, a working composer card that hands off to the REAL
 * chat architecture, capability-checked trust row and honesty promises.
 */
test("homepage explains the product with CTA, quick prompts and honesty promises at 360px", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Your journey starts with");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("a conversation.");
  await expect(
    page.getByText("Tell RailSaarthi where you want to go", { exact: false }),
  ).toBeVisible();

  const cta = page.getByTestId("start-chatting");
  await expect(cta).toBeVisible();
  const box = await cta.boundingBox();
  expect(box && box.height).toBeGreaterThanOrEqual(44);

  // quick-prompt chips (real handoffs, not fake responses)
  for (const s of [
    "Amritsar se Delhi kal",
    "Morning trains to Delhi",
    "Check seat availability",
    "Track my train",
  ]) {
    await expect(page.getByTestId("suggestion").filter({ hasText: s }).first()).toBeVisible();
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
