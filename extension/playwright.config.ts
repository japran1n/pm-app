// F280 (AS-531): loads the built unpacked extension in a persistent
// Chromium context. `launchPersistentContext` + `--disable-extensions-except`
// / `--load-extension` is the current documented way to drive an MV3
// extension end-to-end; headless "old" mode doesn't support extensions, so
// this project runs headed/headless=new via chromium channel.
// Verified against https://playwright.dev/docs/chrome-extensions (current
// docs, MV3 section) as of 2026-08-19.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 30_000,
});
