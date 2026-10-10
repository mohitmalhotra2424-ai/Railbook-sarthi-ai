import { expect, test } from "@playwright/test";

test("search shows the canonical not-configured banner (requirement 5)", async ({ page }) => {
  await page.goto("/trains");
  await page.getByLabel("Search text / खोज").fill("rajdhani");
  await page.getByRole("button", { name: "Search trains" }).click();

  const banner = page.getByTestId("not-configured-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText("Live data provider not configured.");
  await expect(page.getByTestId("source-badge")).toContainText("source: none");
});
