import { expect, test } from "@playwright/test";

test("landing renders brand, nav and honesty promise at 360px", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("रेलसारथी");
  await expect(page.getByRole("link", { name: "Chat with RailSaarthi" })).toBeVisible();
  await expect(page.getByText("Source on every answer")).toBeVisible();
  await expect(page.getByText("No invented data")).toBeVisible();
});
