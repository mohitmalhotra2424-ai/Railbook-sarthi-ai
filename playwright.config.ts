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
    // E2E must be deterministic: LLM credentials from .env.local are cleared
    // for the test server (process env wins over .env.local in Next.js), so
    // the assistant exercises its honest not-configured path.
    command:
      "env LLM_PROVIDER= LLM_MODEL= LLM_API_KEY= LLM_BASE_URL= LLM_FALLBACK_MODEL= LLM_FALLBACK_API_KEY= LLM_FALLBACK_BASE_URL= npm run start -- -p 3100 -H 0.0.0.0",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
