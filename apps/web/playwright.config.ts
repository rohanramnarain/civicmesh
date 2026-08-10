import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for CivicGrid NYC web app.
 *
 * The test web server is started with VITE_FORECAST_MOCK_FALLBACK=true so the
 * selector and forecast flows can be exercised deterministically without
 * relying on live Firestore.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "forecast.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --mode test --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
