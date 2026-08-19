// F280 — AS-531: the extension loads as MV3 and opens its popup on toolbar
// click.
//
// Playwright loads the *built* unpacked extension (extension/dist, produced
// by `vite build`) into a persistent Chromium context via
// `--disable-extensions-except` / `--load-extension`, then opens the popup
// HTML directly (Playwright cannot script a real toolbar-icon click, but
// this is the documented way to drive an MV3 popup end-to-end — see
// https://playwright.dev/docs/chrome-extensions, current MV3 section,
// verified 2026-08-19). We resolve the extension id from a service worker
// event, confirming the background service worker actually started (i.e.
// the extension loaded as a valid MV3 extension), then navigate to
// chrome-extension://<id>/src/popup/index.html — exactly the document
// Chrome renders for the action popup — and assert its content.
import { test, expect, chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const distPath = path.resolve(import.meta.dirname, "..", "dist");

test.beforeAll(() => {
  if (!fs.existsSync(path.join(distPath, "manifest.json"))) {
    throw new Error(
      `Extension build not found at ${distPath}. Run "npm run build" in extension/ before the Playwright test.`,
    );
  }
});

test("AS_531_extension_loads_as_mv3_and_opens_popup_on_toolbar_click", async () => {
  // Extensions require Chromium's headed mode (or a "new" headless build
  // with explicit extension support) to actually start their service
  // worker; the classic headless mode silently ignores --load-extension.
  // See https://playwright.dev/docs/chrome-extensions, verified 2026-08-19.
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
    ],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) {
      worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
    }
    expect(worker.url()).toMatch(/^chrome-extension:\/\//);

    const extensionId = worker.url().split("/")[2];
    expect(extensionId).toBeTruthy();

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

    await expect(page.getByTestId("popup-root")).toBeVisible();
    await expect(page.getByTestId("connection-status")).toHaveText("Not connected");
  } finally {
    await context.close();
  }
});
