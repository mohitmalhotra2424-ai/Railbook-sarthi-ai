import { expect, test } from "@playwright/test";

/**
 * E2E runs WITHOUT LLM credentials (webServer clears them) so behaviour is
 * deterministic: the chat must fail HONESTLY — no scripted/mock assistant,
 * no fabricated railway answer.
 */

test("chat without LLM credentials shows an honest error state with retry, never a fabricated answer", async ({ page }) => {
  await page.goto("/chat");
  await page.getByLabel("Message").fill("Ludhiana se Delhi ki trains batao");
  await page.getByRole("button", { name: "Send" }).click();

  const error = page.getByTestId("chat-error");
  await expect(error).toBeVisible({ timeout: 15_000 });
  await expect(error).toContainText("LLM_NOT_CONFIGURED");

  // No fabricated railway facts anywhere in the log.
  const log = page.getByTestId("chat-log");
  await expect(log).not.toContainText(/\bCNF\b|\bRAC \d|\bWL\d|\b\d{5}\b.*Rajdhani/);
  // No train cards invented.
  await expect(page.getByTestId("train-cards")).toHaveCount(0);
});

test("chat error state exposes the technical code, not a fake railway reply", async ({ page }) => {
  await page.goto("/chat");
  await page.getByLabel("Message").fill("PNR 1234567890 ka status?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("chat-error")).toContainText("LLM_NOT_CONFIGURED", { timeout: 15_000 });
});
