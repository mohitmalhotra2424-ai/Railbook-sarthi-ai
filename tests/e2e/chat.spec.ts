import { expect, test } from "@playwright/test";

test("chat answers honestly when no provider or LLM is configured", async ({ page }) => {
  await page.goto("/chat");
  await page.getByLabel("Message").fill("PNR 1234567890 ka status batao");
  await page.getByRole("button", { name: "Send" }).click();

  const reply = page.getByTestId("chat-message-assistant").first();
  await expect(reply).toBeVisible({ timeout: 15_000 });
  await expect(reply).toContainText("authorized");
  // Never fabricates a booking status (requirement 7).
  await expect(reply).not.toContainText(/\bCNF\b|\bRAC\b|\bWL\d/);
});

test("chat greets in Hindi for Devanagari input", async ({ page }) => {
  await page.goto("/chat");
  await page.getByLabel("Message").fill("नमस्ते");
  await page.getByRole("button", { name: "Send" }).click();

  const reply = page.getByTestId("chat-message-assistant").first();
  await expect(reply).toContainText("रेलसारथी", { timeout: 15_000 });
});
