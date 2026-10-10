import { defineConfig } from "@playwright/test";

/**
 * E2E runs against the PRODUCTION build (`npm run build && npm run start`),
 * on a mobile-first 360×800 viewport, per the Phase 1 test plan.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 360, height: 800 },
    trace: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "mobile-360",
      use: {
        browserName: "chromium",
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "npm run start -- -p 3100 -H 0.0.0.0",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
