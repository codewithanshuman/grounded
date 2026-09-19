import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:8790",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm start",
    url: "http://127.0.0.1:8790/api/health",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      PORT: "8790",
      VERDANT_DB_PATH: resolve("e2e-grounded.db"),
      SITE_PROFILE_DIR: resolve("test-results/site-profiles"),
    },
  },
});
