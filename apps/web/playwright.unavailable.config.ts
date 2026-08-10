import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for testing the unavailable-Firestore state.
 *
 * This uses .env.test-unavailable, which has empty Firebase values and
 * VITE_FORECAST_MOCK_FALLBACK=false, so the app must surface an error
 * instead of silently falling back to mock data.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "unavailable.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "npm run dev -- --mode test-unavailable --host 127.0.0.1 --port 5174",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
