// F291 — AS-554: console and network capture can be turned off per
// report.
//
// Proves the core correctness requirement literally: with a toggle off,
// the underlying hook is NEVER installed on the page (checked via the
// real window marker each hook sets — __pmAppConsoleCapture__ /
// __pmAppNetworkCapture__), not merely hidden in the popup UI. Also
// proves the preference persists across a fresh popup mount via
// chrome.storage.local, and that live counts show once an enabled
// capture actually runs.
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";

const distPath = path.resolve(import.meta.dirname, "..", "dist");

test.beforeAll(() => {
  if (!fs.existsSync(path.join(distPath, "manifest.json"))) {
    throw new Error(
      `Extension build not found at ${distPath}. Run "npm run build" in extension/ before the Playwright test.`,
    );
  }
});

async function launchExtension(): Promise<{ context: BrowserContext; extensionId: string }> {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${distPath}`, `--load-extension=${distPath}`],
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
  }
  const extensionId = worker.url().split("/")[2];

  for (const page of context.pages()) {
    if (page.url() === "about:blank") {
      await page.close();
    }
  }

  return { context, extensionId };
}

const FIXTURE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0">
  <p>privacy toggle fixture</p>
</body>
</html>`;

function startFixtureServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(FIXTURE_HTML);
    });
    server.listen(3000, () => resolve(server));
  });
}

async function openPopup(context: BrowserContext, extensionId: string, contentPage: Page): Promise<Page> {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await contentPage.bringToFront();
  return popupPage;
}

test.describe("AS_554 capture toggles", () => {
  test("AS_554_console_capture_off_means_the_hook_never_installs_and_nothing_is_ever_recorded_even_with_real_console_errors", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();
    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      const popupPage = await openPopup(context, extensionId, contentPage);

      // Toggle starts off by default (private-by-default) — confirm the
      // checkbox itself is unchecked before doing anything else.
      await expect(popupPage.getByTestId("privacy-toggle-console")).not.toBeChecked();

      // Attempt to start console capture while the toggle is off — the
      // button itself is disabled, so a real click cannot even reach it
      // (browsers block click events on disabled elements). Assert that
      // directly, then assert the REAL underlying behaviour too, not
      // just the UI: the page must never have the hook's install marker,
      // even after real console.error calls happen on the page.
      await contentPage.bringToFront();
      await expect(popupPage.getByTestId("console-capture-start-button")).toBeDisabled();
      await contentPage.evaluate(() => {
        console.error("this must never be captured");
        console.warn("neither must this");
      });
      await contentPage.waitForTimeout(200);

      const markerPresent = await contentPage.evaluate(
        () => "__pmAppConsoleCapture__" in (window as unknown as Record<string, unknown>),
      );
      expect(markerPresent).toBe(false);

      // The popup must also never claim capture is "running".
      await expect(popupPage.getByText("Console capture running")).toHaveCount(0);
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("AS_554_network_capture_off_means_the_hook_never_installs_and_nothing_is_ever_recorded_even_with_a_real_failed_fetch", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();
    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      const popupPage = await openPopup(context, extensionId, contentPage);

      await expect(popupPage.getByTestId("privacy-toggle-network")).not.toBeChecked();

      await contentPage.bringToFront();
      await expect(popupPage.getByTestId("network-capture-start-button")).toBeDisabled();

      await contentPage.evaluate(async () => {
        try {
          await fetch("/does-not-exist-404", { method: "GET" });
        } catch {
          // ignore — the point is only that the hook never sees this
        }
      });
      await contentPage.waitForTimeout(200);

      const markerPresent = await contentPage.evaluate(
        () => "__pmAppNetworkCapture__" in (window as unknown as Record<string, unknown>),
      );
      expect(markerPresent).toBe(false);

      await expect(popupPage.getByText("Network capture running")).toHaveCount(0);
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("AS_554_toggling_console_capture_on_allows_the_hook_to_install_and_capture_real_errors", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();
    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      const popupPage = await openPopup(context, extensionId, contentPage);

      await popupPage.getByTestId("privacy-toggle-console").click();
      await expect(popupPage.getByTestId("privacy-toggle-console")).toBeChecked({ timeout: 10_000 });

      await contentPage.bringToFront();
      await popupPage.getByTestId("console-capture-start-button").click();
      await expect(popupPage.getByText("Console capture running")).toBeVisible({ timeout: 10_000 });

      await contentPage.evaluate(() => console.error("captured because toggle is on"));
      await contentPage.waitForTimeout(200);

      const markerPresent = await contentPage.evaluate(
        () => "__pmAppConsoleCapture__" in (window as unknown as Record<string, unknown>),
      );
      expect(markerPresent).toBe(true);

      await popupPage.getByTestId("console-capture-refresh-button").click();
      await expect(popupPage.getByTestId("console-capture-count")).toHaveText("1 message captured.", {
        timeout: 10_000,
      });
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("AS_554_the_toggle_preference_persists_across_a_fresh_popup_mount_via_chrome_storage_local", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();
    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      const firstPopup = await openPopup(context, extensionId, contentPage);

      await firstPopup.getByTestId("privacy-toggle-network").click();
      await expect(firstPopup.getByTestId("privacy-toggle-network")).toBeChecked({ timeout: 10_000 });

      // Confirm it was actually written to chrome.storage.local (not
      // just held in this popup's React state) under the documented key.
      const storedValue = await firstPopup.evaluate(async () => {
        const result = await chrome.storage.local.get("pmapp-capture-preferences");
        return result["pmapp-capture-preferences"];
      });
      expect(storedValue).toEqual({ consoleCaptureEnabled: false, networkCaptureEnabled: true });

      await firstPopup.close();

      // Fresh popup mount — a real close/reopen, not just re-render —
      // must reflect the persisted preference (AS-554's "preference
      // persists per user"), matching F282's established
      // close/reopen-survives-in-chrome.storage.local pattern.
      const secondPopup = await context.newPage();
      await secondPopup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await expect(secondPopup.getByTestId("privacy-toggle-network")).toBeChecked();
      await expect(secondPopup.getByTestId("privacy-toggle-console")).not.toBeChecked();
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("AS_554_live_counts_show_next_to_each_toggle_once_an_enabled_capture_has_actually_run", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();
    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      const popupPage = await openPopup(context, extensionId, contentPage);

      // No count shown before any capture has run.
      await expect(popupPage.getByTestId("privacy-toggle-console-count")).toHaveCount(0);
      await expect(popupPage.getByTestId("privacy-toggle-network-count")).toHaveCount(0);

      await popupPage.getByTestId("privacy-toggle-console").click();
      await expect(popupPage.getByTestId("privacy-toggle-console")).toBeChecked({ timeout: 10_000 });
      await popupPage.getByTestId("privacy-toggle-network").click();
      await expect(popupPage.getByTestId("privacy-toggle-network")).toBeChecked({ timeout: 10_000 });

      await contentPage.bringToFront();
      await popupPage.getByTestId("console-capture-start-button").click();
      await expect(popupPage.getByText("Console capture running")).toBeVisible({ timeout: 10_000 });
      await popupPage.getByTestId("network-capture-start-button").click();
      await expect(popupPage.getByText("Network capture running")).toBeVisible({ timeout: 10_000 });

      await contentPage.evaluate(async () => {
        console.error("one");
        console.error("two");
        try {
          await fetch("/nope-404-please");
        } catch {
          // ignore
        }
      });
      await contentPage.waitForTimeout(300);

      await popupPage.getByTestId("console-capture-refresh-button").click();
      await popupPage.getByTestId("network-capture-refresh-button").click();

      await expect(popupPage.getByTestId("privacy-toggle-console-count")).toContainText("2 console errors captured");
      await expect(popupPage.getByTestId("privacy-toggle-network-count")).toContainText("captured");
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
