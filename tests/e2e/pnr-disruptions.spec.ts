import { expect, test } from "@playwright/test";

test("PNR page shows the not-configured banner for a valid PNR", async ({ page }) => {
  await page.goto("/pnr/1234567890");
  await expect(page.getByTestId("not-configured-banner")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("not-configured-banner")).toContainText(
    "Live data provider not configured.",
  );
});

test("invalid PNR renders a 404", async ({ page }) => {
  const res = await page.goto("/pnr/123");
  expect(res?.status()).toBe(404);
});

test("disruptions page shows the not-configured banner", async ({ page }) => {
  await page.goto("/disruptions");
  await expect(page.getByTestId("not-configured-banner")).toBeVisible({ timeout: 15_000 });
});
