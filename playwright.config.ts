// F090 (AS-150): Playwright config for the board drag-and-drop e2e test.
// Separate test runner from Vitest (unit/integration) — invoked via
// `npx playwright test`, per tech-decisions.md's "How to run tests"
// (`npm run test && npx playwright test`). Only `tests/e2e/**` is picked
// up here; `tests/unit` and `tests/integration` stay on Vitest.
//
// `webServer` boots the real Next.js dev server against the real linked
// Supabase project (same `.env` the integration tests use) so the test
// exercises actual auth cookies, actual RLS, and an actual drag — not a
// mocked app.

import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PLAYWRIGHT_PORT ?? "3100";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
