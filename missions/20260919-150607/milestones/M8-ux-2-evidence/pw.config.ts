import { defineConfig, devices } from "@playwright/test";
const PORT = process.env.PLAYWRIGHT_PORT ?? "3000";
export default defineConfig({
  testDir: "/private/tmp/claude-501/-Users-sasajapranin-Desktop-pm-app/6267a163-faf6-4f39-b34f-172b1d9f60f7/scratchpad/m8p2",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 120_000,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "on" },
  outputDir: "/private/tmp/claude-501/-Users-sasajapranin-Desktop-pm-app/6267a163-faf6-4f39-b34f-172b1d9f60f7/scratchpad/m8p2/artifacts",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
