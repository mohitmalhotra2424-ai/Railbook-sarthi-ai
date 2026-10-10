import { expect, test } from "@playwright/test";

/**
 * Prompt 11 — the redesigned home IS the assistant entry: brand, honest
 * promise, a working composer and starter suggestions, all at 360px.
 */
test("landing renders brand, honesty promise and a usable composer at 360px", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("रेलसारथी");
  // honesty promises remain visible on the first screen
  await expect(page.getByText("Source on every answer")).toBeVisible();
  await expect(page.getByText("No invented data")).toBeVisible();

  // the composer is the primary element: visible, in viewport, usable
  const composer = page.getByLabel("Ask RailSaarthi");
  await expect(composer).toBeVisible();
  await expect(composer).toBeInViewport();
  const send = page.getByRole("button", { name: /Poochhein/ });
  await expect(send).toBeVisible();
  const box = await send.boundingBox();
  expect(box && box.height).toBeGreaterThanOrEqual(40);

  // suggestions are real entry points into the existing chat architecture
  const suggestions = page.getByTestId("suggestion");
  await expect(suggestions).toHaveCount(4);
  await suggestions.first().click();
  await page.waitForURL(/\/chat\?q=/);
  // the handoff performs a REAL turn (honest error without LLM creds here)
  await expect(page.getByTestId("chat-message-user")).toBeVisible({ timeout: 15_000 });
});

test("home composer submits the typed question to the chat", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Ask RailSaarthi").fill("Amritsar se Delhi ki trains");
  await page.getByRole("button", { name: /Poochhein/ }).click();
  // ?q= is cleaned after the handoff
  await page.waitForURL((url) => url.pathname === "/chat" && url.search === "");
  await expect(page.getByTestId("chat-message-user")).toContainText("Amritsar se Delhi ki trains", {
    timeout: 15_000,
  });
});
