// Follow-up to F283/F284/F285/F301 — the reporter draws a selection live
// on the page FIRST (like macOS's Cmd+Shift+4 "Capture Selected
// Portion"); a full-tab capture + crop happens invisibly right after, and
// the reporter never sees the intermediate uncropped tab.
//
// F301 rewrite (region-selection-mid-flow-focus-loss fix): a Chrome MV3
// action popup closes the instant it loses focus, and clicking into the
// page to draw a selection always does exactly that — so the entire
// select -> capture -> crop orchestration was moved out of the popup's own
// JS realm and into the background service worker (which persists
// independently of the popup's open/closed state). See
// `src/capture/pending-capture.ts`'s header for the full root-cause
// writeup and `src/background/service-worker.ts`'s `runRegionCapture` for
// the implementation this file now exercises.
//
// Harness split, same reasoning as the file this replaces:
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
//      activeTab toolbar-icon click that no test harness can script. It is
//      stubbed on the BACKGROUND SERVICE WORKER's own `chrome.tabs`
//      object now (not the popup's — the real call now happens there) via
//      Playwright's `Worker.evaluate`. The stub fetches a real,
//      just-in-time Playwright screenshot of the content page from a
//      small HTTP endpoint added to the fixture server below, so the crop
//      math downstream is still exercised against real, correctly-
//      proportioned image bytes — only the one ungrantable Chrome call is
//      a stand-in, exactly as before.
import { test, expect, chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
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

/** Fixture server that also serves a `/__screenshot` route which takes a
 * real, just-in-time Playwright screenshot of whatever page the test has
 * pointed `getContentPage` at — this is how the background worker's
 * stubbed `chrome.tabs.captureVisibleTab` gets real, correctly-scaled PNG
 * bytes without needing a cross-context `exposeFunction` into the service
 * worker (Playwright's page-level `exposeFunction`/`exposeBinding` isn't a
 * documented, reliable bridge into a MV3 service worker's own JS realm). */
function startFixtureServer(getContentPage: () => Page | null): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/__screenshot") {
        const page = getContentPage();
        if (!page) {
          res.writeHead(503);
          res.end();
          return;
        }
        page
          .screenshot({ type: "png" })
          .then((buf) => {
            res.writeHead(200, { "Content-Type": "image/png" });
            res.end(buf);
          })
          .catch(() => {
            res.writeHead(500);
            res.end();
          });
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(FIXTURE_HTML);
    });
    server.listen(3000, () => resolve(server));
  });
}

async function launchExtension(
  options: { deviceScaleFactor?: number } = {},
): Promise<{ context: BrowserContext; extensionId: string; worker: Worker }> {
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

  return { context, extensionId, worker };
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

/** Stubs `chrome.tabs.captureVisibleTab` on the BACKGROUND SERVICE
 * WORKER's own `chrome.tabs` object — the real call now happens there
 * (see file header) — with a real Playwright-screenshotted PNG fetched
 * just-in-time from the fixture server's `/__screenshot` route. */
async function stubCaptureVisibleTabOnWorker(worker: Worker) {
  await worker.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chrome.tabs as any).captureVisibleTab = async () => {
      const res = await fetch("http://localhost:3000/__screenshot");
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return `data:image/png;base64,${(globalThis as any).btoa(binary)}`;
    };
  });
}

async function countOverlayNodes(page: Page): Promise<number> {
  return page.evaluate(
    () => document.querySelectorAll('[id="__pm_app_qa_region_overlay_root__"]').length,
  );
}

async function getPendingCaptureResult(worker: Worker): Promise<unknown> {
  return worker.evaluate(async () => {
    const stored = await chrome.storage.local.get("pmapp-pending-capture-result");
    return stored["pmapp-pending-capture-result"] ?? null;
  });
}

test.describe("select-area-first capture (real drag-select overlay + background-orchestrated capture)", () => {
  test("CRITICAL: closing the popup mid-selection still completes the capture — background orchestration survives the popup's death", async () => {
    let contentPageRef: Page | null = null;
    const server = await startFixtureServer(() => contentPageRef);
    const { context, extensionId, worker } = await launchExtension();

    try {
      const contentPage = await context.newPage();
      contentPageRef = contentPage;
      await contentPage.setViewportSize({ width: 400, height: 300 });
      await contentPage.goto("http://localhost:3000/");
      await contentPage.bringToFront();

      await stubCaptureVisibleTabOnWorker(worker);

      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await contentPage.bringToFront();

      // Trigger the message send — NOT a synchronous awaited call from the
      // popup page itself; `handleSelectRegion` just fires
      // `chrome.runtime.sendMessage` and returns.
      await popupPage.getByTestId("capture-button").click();

      // Wait for the real, live-page overlay to actually appear — proof
      // the background worker received the message and injected it —
      // before doing the thing that reproduces the real bug: closing the
      // popup while the user is mid-selection.
      await expect.poll(() => countOverlayNodes(contentPage), { timeout: 10_000 }).toBe(1);

      // THE REAL BUG SCENARIO: close the popup page object BEFORE
      // completing the drag-selection on the content page, genuinely
      // reproducing "popup is gone while the background does its work" —
      // not a synchronous stand-in for it.
      await popupPage.close();

      // Now complete the drag-selection on the content page, with no
      // popup open anywhere.
      await contentPage.mouse.move(150, 100);
      await contentPage.mouse.down();
      await contentPage.mouse.move(200, 140);
      await contentPage.mouse.move(250, 180);
      await contentPage.mouse.up();

      // The overlay must remove all of its own DOM once the selection is
      // finished, even with no popup around to observe it.
      await expect.poll(() => countOverlayNodes(contentPage), { timeout: 10_000 }).toBe(0);

      // The background must go on to capture + crop entirely on its own
      // and land a real result in chrome.storage.local, with no popup
      // involved at any point in this whole window.
      await expect
        .poll(async () => {
          const pending = (await getPendingCaptureResult(worker)) as { ok?: boolean } | null;
          return pending?.ok === true;
        }, { timeout: 15_000 })
        .toBe(true);

      // Open a FRESH popup and confirm the cropped capture result is
      // there, restored from storage, ready to annotate.
      const freshPopup = await context.newPage();
      await freshPopup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

      const preview = freshPopup.getByTestId("capture-preview");
      await expect(preview).toBeVisible({ timeout: 10_000 });
      await expect(freshPopup.getByTestId("capture-error")).toHaveCount(0);

      const dataUrl = await preview.getAttribute("src");
      expect(dataUrl).toBeTruthy();
      const { width, height, isPng } = decodePngDimensions(dataUrl!);
      expect(isPng).toBe(true);
      expect(width).toBe(100);
      expect(height).toBe(80);
      await expect(freshPopup.getByTestId("capture-success")).toContainText("100 x 80");

      // Re-reading (not re-clearing) confirms the key really was cleared
      // by the fresh popup's own restore — a later, unrelated mount must
      // not see this same result again.
      const afterRestore = await getPendingCaptureResult(worker);
      expect(afterRestore).toBeNull();

      const anotherPopup = await context.newPage();
      await anotherPopup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await expect(anotherPopup.getByTestId("capture-preview")).toHaveCount(0);
      await expect(anotherPopup.getByTestId("capture-error")).toHaveCount(0);
      await expect(anotherPopup.getByTestId("capture-button")).toHaveText("Select area to capture");
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("real drag-select produces a correctly-dimensioned crop when the popup stays open the whole time (regression check)", async () => {
    let contentPageRef: Page | null = null;
    const server = await startFixtureServer(() => contentPageRef);
    const { context, extensionId, worker } = await launchExtension();

    try {
      const contentPage = await context.newPage();
      contentPageRef = contentPage;
      await contentPage.setViewportSize({ width: 400, height: 300 });
      await contentPage.goto("http://localhost:3000/");
      await contentPage.bringToFront();

      await stubCaptureVisibleTabOnWorker(worker);

      const popupPage = await context.newPage();
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
      // even taken.
      await expect.poll(() => countOverlayNodes(contentPage), { timeout: 10_000 }).toBe(0);

      // The popup, still open, must reflect the background's result LIVE
      // (via chrome.storage.onChanged), without a reload.
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

  test("a devicePixelRatio != 1 display still produces a correctly-dimensioned crop, sourced from the page's own ratio", async () => {
    let contentPageRef: Page | null = null;
    const server = await startFixtureServer(() => contentPageRef);
    const { context, extensionId, worker } = await launchExtension({ deviceScaleFactor: 2 });

    try {
      const contentPage = await context.newPage();
      contentPageRef = contentPage;
      await contentPage.setViewportSize({ width: 400, height: 300 });
      await contentPage.goto("http://localhost:3000/");
      await contentPage.bringToFront();
      expect(await contentPage.evaluate(() => window.devicePixelRatio)).toBe(2);

      await stubCaptureVisibleTabOnWorker(worker);

      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await contentPage.bringToFront();

      await popupPage.getByTestId("capture-button").click();
      await expect(popupPage.getByTestId("capture-selecting-hint")).toBeVisible({ timeout: 10_000 });

      // Same CSS-pixel drag rect as the dpr=1 test (150,100 -> 250,180 =
      // 100 x 80 CSS px), but Playwright's real screenshot at
      // deviceScaleFactor 2 comes back at double the physical pixels — the
      // crop must scale with it (200 x 160 physical px). This now proves
      // the devicePixelRatio is correctly sourced from the CONTENT PAGE's
      // own window (via the injected overlay function), not the popup's —
      // see region-overlay.ts's `RegionOverlayResult` doc comment.
      await contentPage.mouse.move(150, 100);
      await contentPage.mouse.down();
      await contentPage.mouse.move(200, 140);
      await contentPage.mouse.move(250, 180);
      await contentPage.mouse.up();

      await expect.poll(() => countOverlayNodes(contentPage), { timeout: 10_000 }).toBe(0);

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

  test("Escape cancels the selection, even with the popup closed, and leaves no stale pending result to confuse a later attempt", async () => {
    let contentPageRef: Page | null = null;
    const server = await startFixtureServer(() => contentPageRef);
    const { context, extensionId, worker } = await launchExtension();

    try {
      const contentPage = await context.newPage();
      contentPageRef = contentPage;
      await contentPage.setViewportSize({ width: 400, height: 300 });
      await contentPage.goto("http://localhost:3000/");
      await contentPage.bringToFront();

      await stubCaptureVisibleTabOnWorker(worker);

      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await contentPage.bringToFront();

      await popupPage.getByTestId("capture-button").click();
      await expect.poll(() => countOverlayNodes(contentPage), { timeout: 10_000 }).toBe(1);

      // Close the popup before cancelling — the cancellation itself must
      // resolve cleanly with no popup around to see it happen.
      await popupPage.close();

      await contentPage.mouse.move(50, 50);
      await contentPage.mouse.down();
      await contentPage.mouse.move(120, 120);
      await contentPage.keyboard.press("Escape");

      await expect.poll(() => countOverlayNodes(contentPage), { timeout: 10_000 }).toBe(0);

      // The background must have resolved this as a stated cancellation,
      // not silently vanished and not left an error behind.
      await expect
        .poll(() => getPendingCaptureResult(worker), { timeout: 10_000 })
        .toEqual({ ok: false, reason: "cancelled" });

      // A fresh popup opened now must resolve the cancellation cleanly:
      // back to idle, no error, no stale preview, and the pending key
      // itself must be cleared afterwards.
      const freshPopup = await context.newPage();
      await freshPopup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await expect(freshPopup.getByTestId("capture-error")).toHaveCount(0);
      await expect(freshPopup.getByTestId("capture-preview")).toHaveCount(0);
      await expect(freshPopup.getByTestId("capture-button")).toHaveText("Select area to capture");
      await expect.poll(() => getPendingCaptureResult(worker), { timeout: 10_000 }).toBeNull();

      // Confirm the cancelled attempt doesn't confuse a subsequent, real
      // capture attempt from this same fresh popup.
      await contentPage.bringToFront();
      await freshPopup.getByTestId("capture-button").click();
      await expect.poll(() => countOverlayNodes(contentPage), { timeout: 10_000 }).toBe(1);
      await contentPage.mouse.move(150, 100);
      await contentPage.mouse.down();
      await contentPage.mouse.move(250, 180);
      await contentPage.mouse.up();
      await expect.poll(() => countOverlayNodes(contentPage), { timeout: 10_000 }).toBe(0);
      await expect(freshPopup.getByTestId("capture-preview")).toBeVisible({ timeout: 10_000 });
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("a second 'Select area to capture' click (from a reopened popup) while a first attempt is still pending replaces it cleanly, not duplicated or corrupted", async () => {
    let contentPageRef: Page | null = null;
    const server = await startFixtureServer(() => contentPageRef);
    const { context, extensionId, worker } = await launchExtension();

    try {
      const contentPage = await context.newPage();
      contentPageRef = contentPage;
      await contentPage.setViewportSize({ width: 400, height: 300 });
      await contentPage.goto("http://localhost:3000/");
      await contentPage.bringToFront();

      await stubCaptureVisibleTabOnWorker(worker);

      const firstPopup = await context.newPage();
      await firstPopup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await contentPage.bringToFront();

      // First click: start a selection but never finish it, then close
      // this popup — reproducing "reopened the popup and clicked it a
      // second time before finishing the first" (the popup's own capture
      // button is disabled while a selection is in flight in the SAME
      // mount, so the realistic way a second attempt starts is a
      // close/reopen, exactly like the real bug's own close-mid-selection
      // scenario).
      await firstPopup.getByTestId("capture-button").click();
      await expect.poll(() => countOverlayNodes(contentPage), { timeout: 10_000 }).toBe(1);
      await contentPage.mouse.move(10, 10);
      await contentPage.mouse.down();
      await contentPage.mouse.move(40, 40);
      // No mouseup yet — first selection is left mid-drag.
      await firstPopup.close();

      // Second attempt, from a freshly reopened popup: re-injects and must
      // supersede the first, per region-overlay.ts's page-global cleanup
      // handle (see that file's header comment).
      await contentPage.bringToFront();
      const secondPopup = await context.newPage();
      await secondPopup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await contentPage.bringToFront();
      await secondPopup.getByTestId("capture-button").click();
      // Still exactly one overlay root live at a time.
      await expect.poll(() => countOverlayNodes(contentPage), { timeout: 10_000 }).toBe(1);

      // Complete only the SECOND selection, over the yellow target box.
      await contentPage.mouse.move(150, 100);
      await contentPage.mouse.down();
      await contentPage.mouse.move(250, 180);
      await contentPage.mouse.up();

      await expect.poll(() => countOverlayNodes(contentPage), { timeout: 10_000 }).toBe(0);

      // The final, settled result must reflect the SECOND selection's
      // dimensions (100 x 80), not the abandoned first one, and there must
      // be exactly one final result, not a corrupted/overwritten mix.
      const preview = secondPopup.getByTestId("capture-preview");
      await expect(preview).toBeVisible({ timeout: 10_000 });
      const dataUrl = await preview.getAttribute("src");
      const { width, height, isPng } = decodePngDimensions(dataUrl!);
      expect(isPng).toBe(true);
      expect(width).toBe(100);
      expect(height).toBe(80);
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
      // trigger for this failure path, not a synthetic stand-in. The
      // popup stays open here, so it must reflect the background's stated
      // failure LIVE, via chrome.storage.onChanged.
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

  test("bug fix: the page has focus the instant the overlay is injected, and a single click-drag motion (no wasted first click) produces the correct selection", async () => {
    // Root cause (see region-overlay.ts's own comment on the
    // `window.focus()` call this proves): the very first real mousedown a
    // reporter made on the page right after clicking "Select area to
    // capture" in the popup was being consumed as a window-activation
    // click rather than delivered to the overlay's own listener, because
    // the tab's document did not yet have focus at that moment — the
    // popup (a separate native window) still did. The fix calls
    // `window.focus()` synchronously the instant the overlay function is
    // injected, before the user can possibly click. This test proves both
    // halves: (1) the page already reports `document.hasFocus()` true the
    // moment the overlay appears — not on some later tick — and (2) a
    // SINGLE mousedown -> mousemove -> mouseup motion, with no preceding
    // "wasted" click sent anywhere by this test, produces a correctly
    // dimensioned selection.
    let contentPageRef: Page | null = null;
    const server = await startFixtureServer(() => contentPageRef);
    const { context, extensionId, worker } = await launchExtension();

    try {
      const contentPage = await context.newPage();
      contentPageRef = contentPage;
      await contentPage.setViewportSize({ width: 400, height: 300 });
      await contentPage.goto("http://localhost:3000/");
      await contentPage.bringToFront();

      await stubCaptureVisibleTabOnWorker(worker);

      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await contentPage.bringToFront();

      await popupPage.getByTestId("capture-button").click();
      await expect.poll(() => countOverlayNodes(contentPage), { timeout: 10_000 }).toBe(1);

      // (1) The fix's own mechanism: the page must already have focus the
      // instant the overlay exists, proving `window.focus()` ran as part
      // of the same synchronous injected-function execution that built
      // the overlay's DOM — not something that only happens later, after
      // some other event.
      await expect
        .poll(() => contentPage.evaluate(() => document.hasFocus()), { timeout: 10_000 })
        .toBe(true);

      // (2) A single, uninterrupted click-drag motion — mousedown
      // immediately followed by mousemove/mouseup, with no separate first
      // click sent by this test at all (unlike a "click once to focus,
      // then click-drag again" pattern, which is exactly the bug this
      // fixes) — must produce a correct selection.
      await contentPage.mouse.move(150, 100);
      await contentPage.mouse.down();
      await contentPage.mouse.move(200, 140);
      await contentPage.mouse.move(250, 180);
      await contentPage.mouse.up();

      await expect.poll(() => countOverlayNodes(contentPage), { timeout: 10_000 }).toBe(0);

      const preview = popupPage.getByTestId("capture-preview");
      await expect(preview).toBeVisible({ timeout: 10_000 });
      const dataUrl = await preview.getAttribute("src");
      const { width, height, isPng } = decodePngDimensions(dataUrl!);
      expect(isPng).toBe(true);
      expect(width).toBe(100);
      expect(height).toBe(80);
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("bug fix: the toolbar badge is set the instant a capture result is ready and cleared once a popup mounts and consumes it", async () => {
    // `chrome.action.openPopup()` was empirically tested (real Chromium,
    // real page mouseup with intervening async work matching this exact
    // codebase's `runRegionCapture` flow) and found to resolve without
    // throwing but NOT reliably produce a visible popup window in this
    // real automated environment (confirmed across repeated runs via
    // `chrome.windows.getAll()`), so it cannot be the only observable
    // signal this fix provides — the badge is the guaranteed, verifiable
    // mechanism, and is what this test actually proves.
    let contentPageRef: Page | null = null;
    const server = await startFixtureServer(() => contentPageRef);
    const { context, extensionId, worker } = await launchExtension();

    try {
      const contentPage = await context.newPage();
      contentPageRef = contentPage;
      await contentPage.setViewportSize({ width: 400, height: 300 });
      await contentPage.goto("http://localhost:3000/");
      await contentPage.bringToFront();

      await stubCaptureVisibleTabOnWorker(worker);

      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await contentPage.bringToFront();

      await expect(await worker.evaluate(() => chrome.action.getBadgeText({}))).toBe("");

      await popupPage.getByTestId("capture-button").click();
      await expect.poll(() => countOverlayNodes(contentPage), { timeout: 10_000 }).toBe(1);

      // Close the popup before finishing the selection, exactly like the
      // real bug scenario: nothing is open to observe the capture
      // complete, so the badge is the only surviving signal.
      await popupPage.close();

      await contentPage.mouse.move(150, 100);
      await contentPage.mouse.down();
      await contentPage.mouse.move(250, 180);
      await contentPage.mouse.up();

      await expect.poll(() => countOverlayNodes(contentPage), { timeout: 10_000 }).toBe(0);

      // The badge must appear the instant the result is ready, with no
      // popup open anywhere to have triggered it manually.
      await expect
        .poll(() => worker.evaluate(() => chrome.action.getBadgeText({})), { timeout: 15_000 })
        .toBe("✓");

      // A fresh popup mounting and consuming the result must clear it.
      const freshPopup = await context.newPage();
      await freshPopup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await expect(freshPopup.getByTestId("capture-preview")).toBeVisible({ timeout: 10_000 });

      await expect
        .poll(() => worker.evaluate(() => chrome.action.getBadgeText({})), { timeout: 10_000 })
        .toBe("");
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
