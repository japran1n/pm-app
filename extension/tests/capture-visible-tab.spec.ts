// Follow-up to F283/F284/F285 (superseding AS-539/AS-540's old two-step
// "Capture screenshot" then "Select region…" flow — see
// extension/src/capture/region-overlay.ts's header for the full design
// rationale). The reporter now draws a selection live on the page FIRST
// (like macOS's Cmd+Shift+4 "Capture Selected Portion"); a full-tab
// capture + crop happens invisibly right after, and the reporter never
// sees the intermediate uncropped tab. There is no more "capture whole
// tab" fallback path at all.
//
// Harness split, same reasoning as the old file this replaces:
//   1. `chrome.scripting.executeScript` (region-overlay.ts) does NOT
//      strictly require a real toolbar-icon activeTab gesture to succeed
//      IF the target tab's origin is already covered by a declared
//      `host_permissions` entry — this manifest already declares
//      `host_permissions: ["http://localhost:3000/*"]` (F281, reused by
//      F287's element-picker-selector.spec.ts for the exact same reason).
//      So the drag-select overlay itself — real DOM, real mouse events,
//      real removal on both success and Escape — is proven fully for real
//      against a real localhost:3000 page below.
//   2. `chrome.tabs.captureVisibleTab` still strictly requires a real
//      activeTab toolbar-icon click that no test harness can script
//      (verified empirically against this exact build, see the old file's
//      header — unchanged in this rewrite). It is stubbed with a real
//      Playwright-screenshotted PNG of the exact same page the overlay
//      selection was just drawn on, so the crop math downstream is
//      exercised against real, correctly-proportioned image bytes — only
//      the one ungrantable Chrome call is a stand-in.
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { Buffer } from "node:buffer";

const distPath = path.resolve(import.meta.dirname, "..", "dist");
const popupSourcePath = path.resolve(import.meta.dirname, "..", "src", "popup", "Popup.tsx");

test.beforeAll(() => {
  if (!fs.existsSync(path.join(distPath, "manifest.json"))) {
    throw new Error(
      `Extension build not found at ${distPath}. Run "npm run build" in extension/ before the Playwright test.`,
    );
  }
});

const FIXTURE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;background:#3366cc;width:400px;height:300px">
  <div style="position:absolute;left:150px;top:100px;width:100px;height:80px;background:#ffcc00">target</div>
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

async function launchExtension(
  options: { deviceScaleFactor?: number } = {},
): Promise<{ context: BrowserContext; extensionId: string }> {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    deviceScaleFactor: options.deviceScaleFactor,
    args: [`--disable-extensions-except=${distPath}`, `--load-extension=${distPath}`],
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
  }
  const extensionId = worker.url().split("/")[2];

  // Close the blank initial tab — see element-picker-selector.spec.ts's
  // launchExtension for why this matters for chrome.tabs.query targeting.
  for (const page of context.pages()) {
    if (page.url() === "about:blank") {
      await page.close();
    }
  }

  return { context, extensionId };
}

/** Decode a PNG data URL's width/height straight from the IHDR chunk. */
function decodePngDimensions(dataUrl: string): { width: number; height: number; isPng: boolean } {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  const buf = Buffer.from(base64, "base64");
  const isPng =
    buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height, isPng };
}

/** The only thing this build cannot grant for real (see file header):
 * `chrome.tabs.captureVisibleTab` needs a real toolbar-icon gesture.
 * Stubbed with a real Playwright screenshot of `contentPage` taken at the
 * moment of the call, so the crop math after it runs against real,
 * correctly-scaled bytes. */
async function stubCaptureVisibleTabWithRealScreenshot(popupPage: Page, contentPage: Page) {
  await popupPage.exposeFunction("__takeRealScreenshot", async () => {
    const buf = await contentPage.screenshot({ type: "png" });
    return `data:image/png;base64,${buf.toString("base64")}`;
  });
  await popupPage.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chrome.tabs as any).captureVisibleTab = async () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__takeRealScreenshot();
  });
}

async function countOverlayNodes(page: Page): Promise<number> {
  return page.evaluate(
    () => document.querySelectorAll('[id="__pm_app_qa_region_overlay_root__"]').length,
  );
}

test.describe("select-area-first capture (real drag-select overlay + real crop math)", () => {
  test("real drag-select on the live page produces a correctly-dimensioned crop, and the overlay DOM is fully gone afterwards", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();

    try {
      const contentPage = await context.newPage();
      await contentPage.setViewportSize({ width: 400, height: 300 });
      await contentPage.goto("http://localhost:3000/");
      await contentPage.bringToFront();

      const popupPage = await context.newPage();
      await stubCaptureVisibleTabWithRealScreenshot(popupPage, contentPage);
      await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await contentPage.bringToFront();

      await popupPage.getByTestId("capture-button").click();
      await expect(popupPage.getByTestId("capture-selecting-hint")).toBeVisible({ timeout: 10_000 });

      // Real click-drag on the real live page, over the yellow target box
      // (150,100 -> 250,180 in CSS pixels), driving the real injected
      // mousedown/mousemove/mouseup listeners.
      await contentPage.mouse.move(150, 100);
      await contentPage.mouse.down();
      await contentPage.mouse.move(200, 140);
      await contentPage.mouse.move(250, 180);
      await contentPage.mouse.up();

      // The overlay must remove ALL of its own DOM before the crop is
      // even taken — proven here as a real DOM query on the live page for
      // zero leftover nodes, not just "the promise settled".
      await expect
        .poll(() => countOverlayNodes(contentPage), { timeout: 10_000 })
        .toBe(0);

      await expect(popupPage.getByTestId("capture-error")).toHaveCount(0);
      const preview = popupPage.getByTestId("capture-preview");
      await expect(preview).toBeVisible({ timeout: 10_000 });

      const dataUrl = await preview.getAttribute("src");
      expect(dataUrl).toBeTruthy();
      const { width, height, isPng } = decodePngDimensions(dataUrl!);
      expect(isPng).toBe(true);
      // devicePixelRatio 1 in this default (non-HiDPI) context, so the
      // physical-pixel crop equals the CSS-pixel drag rect (100 x 80).
      expect(width).toBe(100);
      expect(height).toBe(80);

      await expect(popupPage.getByTestId("capture-success")).toContainText("100 x 80");
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("a devicePixelRatio != 1 display still produces a correctly-dimensioned crop", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension({ deviceScaleFactor: 2 });

    try {
      const contentPage = await context.newPage();
      await contentPage.setViewportSize({ width: 400, height: 300 });
      await contentPage.goto("http://localhost:3000/");
      await contentPage.bringToFront();
      expect(await contentPage.evaluate(() => window.devicePixelRatio)).toBe(2);

      const popupPage = await context.newPage();
      await stubCaptureVisibleTabWithRealScreenshot(popupPage, contentPage);
      await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await contentPage.bringToFront();
      expect(await popupPage.evaluate(() => window.devicePixelRatio)).toBe(2);

      await popupPage.getByTestId("capture-button").click();
      await expect(popupPage.getByTestId("capture-selecting-hint")).toBeVisible({ timeout: 10_000 });

      // Same CSS-pixel drag rect as the dpr=1 test (150,100 -> 250,180 =
      // 100 x 80 CSS px), but Playwright's real screenshot at
      // deviceScaleFactor 2 comes back at double the physical pixels — the
      // crop must scale with it (200 x 160 physical px), proving the real
      // `devicePixelRatio` math in Popup.tsx / crop.ts, not a hardcoded 1x
      // assumption.
      await contentPage.mouse.move(150, 100);
      await contentPage.mouse.down();
      await contentPage.mouse.move(200, 140);
      await contentPage.mouse.move(250, 180);
      await contentPage.mouse.up();

      await expect
        .poll(() => countOverlayNodes(contentPage), { timeout: 10_000 })
        .toBe(0);

      const preview = popupPage.getByTestId("capture-preview");
      await expect(preview).toBeVisible({ timeout: 10_000 });
      const dataUrl = await preview.getAttribute("src");
      const { width, height, isPng } = decodePngDimensions(dataUrl!);
      expect(isPng).toBe(true);
      expect(width).toBe(200);
      expect(height).toBe(160);
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("Escape cancels the selection, removes all overlay DOM, and captures nothing", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();

    try {
      const contentPage = await context.newPage();
      await contentPage.setViewportSize({ width: 400, height: 300 });
      await contentPage.goto("http://localhost:3000/");
      await contentPage.bringToFront();

      const popupPage = await context.newPage();
      await stubCaptureVisibleTabWithRealScreenshot(popupPage, contentPage);
      await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await contentPage.bringToFront();

      await popupPage.getByTestId("capture-button").click();
      await expect(popupPage.getByTestId("capture-selecting-hint")).toBeVisible({ timeout: 10_000 });

      await contentPage.mouse.move(50, 50);
      await contentPage.mouse.down();
      await contentPage.mouse.move(120, 120);
      // Cancel mid-drag, before mouseup.
      await contentPage.keyboard.press("Escape");

      await expect
        .poll(() => countOverlayNodes(contentPage), { timeout: 10_000 })
        .toBe(0);

      // Back to idle: no capture attempted, no error, no preview.
      await expect(popupPage.getByTestId("capture-error")).toHaveCount(0);
      await expect(popupPage.getByTestId("capture-preview")).toHaveCount(0);
      await expect(popupPage.getByTestId("capture-button")).toHaveText("Select area to capture");
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("the old two-step 'capture whole tab, then select region inside the popup' flow is fully gone", async () => {
    // Static check: neither the old post-capture crop component nor its
    // old two-button UI text exist anywhere in the shipped popup source.
    const popupSource = fs.readFileSync(popupSourcePath, "utf8");
    expect(popupSource).not.toMatch(/RegionSelect/);
    expect(popupSource).not.toMatch(/Capture screenshot/);
    expect(popupSource).not.toMatch(/Select region/);
    expect(fs.existsSync(path.resolve(import.meta.dirname, "..", "src", "capture", "RegionSelect.tsx"))).toBe(
      false,
    );

    // Live UI check: there is exactly one capture action, and it is the
    // new select-first one.
    const { context, extensionId } = await launchExtension();
    try {
      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

      await expect(popupPage.getByTestId("capture-button")).toHaveCount(1);
      await expect(popupPage.getByTestId("capture-button")).toHaveText("Select area to capture");
      await expect(popupPage.getByTestId("region-select-start-button")).toHaveCount(0);
      await expect(popupPage.getByText("Capture screenshot", { exact: true })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("selecting on a restricted chrome:// page explains why, through the new select-first flow, instead of failing silently", async () => {
    const { context, extensionId } = await launchExtension();

    try {
      // chrome://extensions is one of the documented restricted surfaces
      // `chrome.scripting.executeScript` can never inject into
      // (https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
      // "restrictions", verified 2026-08-19) — a real, deterministic
      // trigger for this failure path, not a synthetic stand-in.
      const restrictedPage = await context.newPage();
      await restrictedPage.goto("chrome://extensions");
      await restrictedPage.bringToFront();

      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await popupPage.bringToFront();

      await popupPage.getByTestId("capture-button").click();

      const errorEl = popupPage.getByTestId("capture-error");
      await expect(errorEl).toBeVisible({ timeout: 10_000 });

      const message = await errorEl.textContent();
      expect(message).toBeTruthy();
      // Must not be a generic/confusing message.
      expect(message!.length).toBeGreaterThan(15);
      expect(message).not.toMatch(/^error$/i);
      expect(message).not.toMatch(/^failed$/i);
      expect(message!.toLowerCase()).toMatch(/chrome|restrict|cannot|internal/i);

      await expect(popupPage.getByTestId("capture-preview")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
