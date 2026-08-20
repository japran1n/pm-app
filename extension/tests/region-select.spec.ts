// F284 — AS-540: the user can capture a region instead of the whole visible
// area.
//
// Follows the exact harness pattern documented in
// extension/tests/capture-visible-tab.spec.ts: `chrome.tabs.captureVisibleTab`
// / `chrome.tabs.query` are stubbed (the only ungrantable piece — a real
// `activeTab` toolbar-icon click cannot be scripted by Playwright, same
// root cause documented there) with a *real* PNG Playwright itself
// screenshotted, so everything downstream — drag-select math, the crop
// itself, and the resulting image's real pixel dimensions — is exercised
// for real through the real built popup UI, not mocked.
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { Buffer } from "node:buffer";

const distPath = path.resolve(import.meta.dirname, "..", "dist");

test.beforeAll(() => {
  if (!fs.existsSync(path.join(distPath, "manifest.json"))) {
    throw new Error(
      `Extension build not found at ${distPath}. Run "npm run build" in extension/ before the Playwright test.`,
    );
  }
});

async function launchExtension(): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
    ],
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
  }
  const extensionId = worker.url().split("/")[2];
  return { context, extensionId };
}

function decodePngDimensions(dataUrl: string): { width: number; height: number; isPng: boolean } {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  const buf = Buffer.from(base64, "base64");
  const isPng =
    buf.length > 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height, isPng };
}

async function stubCaptureVisibleTab(page: Page, resolveWith: string, devicePixelRatio: number) {
  await page.addInitScript(
    ({ dataUrl, dpr }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (chrome.tabs as any).captureVisibleTab = async () => dataUrl;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (chrome.tabs as any).query = async () => [{ active: true, url: "http://example.com/" }];
      Object.defineProperty(window, "devicePixelRatio", { value: dpr, configurable: true });
    },
    { dataUrl: resolveWith, dpr: devicePixelRatio },
  );
}

async function setupCapturedPopup(
  context: BrowserContext,
  extensionId: string,
  devicePixelRatio: number,
): Promise<{ popupPage: Page; capturedDataUrl: string; naturalWidth: number; naturalHeight: number }> {
  // A physical-pixel-sized PNG standing in for what captureVisibleTab
  // would really return (bigger than the popup viewport, like a real
  // full-tab capture, so the CSS-pixel display is meaningfully scaled by
  // devicePixelRatio).
  const contentPage = await context.newPage();
  await contentPage.setViewportSize({ width: 400, height: 300 });
  await contentPage.setContent(
    "<html><body style='margin:0;background:linear-gradient(90deg,red,blue);width:400px;height:300px'></body></html>",
  );
  const screenshotBuffer = await contentPage.screenshot({ type: "png" });
  const capturedDataUrl = `data:image/png;base64,${screenshotBuffer.toString("base64")}`;
  const { width: naturalWidth, height: naturalHeight } = decodePngDimensions(capturedDataUrl);

  const popupPage = await context.newPage();
  await stubCaptureVisibleTab(popupPage, capturedDataUrl, devicePixelRatio);
  await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

  await popupPage.getByTestId("capture-button").click();
  await expect(popupPage.getByTestId("capture-preview")).toBeVisible({ timeout: 10_000 });

  return { popupPage, capturedDataUrl, naturalWidth, naturalHeight };
}

test("AS_540_user_can_select_and_crop_a_region_instead_of_the_whole_capture", async () => {
  const { context, extensionId } = await launchExtension();

  try {
    const devicePixelRatio = 1;
    const { popupPage, naturalWidth, naturalHeight } = await setupCapturedPopup(
      context,
      extensionId,
      devicePixelRatio,
    );

    await popupPage.getByTestId("region-select-start-button").click();
    await expect(popupPage.getByTestId("region-select-overlay")).toBeVisible();

    const image = popupPage.getByTestId("region-select-image");
    await expect(image).toBeVisible();
    const box = await image.boundingBox();
    expect(box).toBeTruthy();

    // The preview should be displayed true-to-page-size (CSS px = physical
    // px / devicePixelRatio); at devicePixelRatio 1 that's the natural size.
    expect(Math.round(box!.width)).toBe(naturalWidth);
    expect(Math.round(box!.height)).toBe(naturalHeight);

    // Drag a selection: from (40, 30) to (160, 110) within the image,
    // i.e. a 120 x 80 CSS-pixel region.
    const startX = box!.x + 40;
    const startY = box!.y + 30;
    const endX = box!.x + 160;
    const endY = box!.y + 110;

    await popupPage.mouse.move(startX, startY);
    await popupPage.mouse.down();
    await popupPage.mouse.move(endX, endY, { steps: 5 });

    // Live width x height readout tracks the drag before mouseup.
    await expect(popupPage.getByTestId("region-select-readout")).toHaveText("120 x 80 px");

    await popupPage.mouse.up();
    await expect(popupPage.getByTestId("region-select-readout")).toHaveText("120 x 80 px");

    const cropButton = popupPage.getByTestId("region-crop-confirm-button");
    await expect(cropButton).toBeEnabled();
    await cropButton.click();

    // The overlay is gone; a new, smaller, real cropped PNG is shown.
    await expect(popupPage.getByTestId("region-select-overlay")).toHaveCount(0);
    const croppedPreview = popupPage.getByTestId("capture-preview");
    await expect(croppedPreview).toBeVisible();

    const croppedDataUrl = await croppedPreview.getAttribute("src");
    expect(croppedDataUrl).toBeTruthy();
    const { width, height, isPng } = decodePngDimensions(croppedDataUrl!);
    expect(isPng).toBe(true);
    // devicePixelRatio 1: CSS-pixel selection maps 1:1 onto physical pixels.
    expect(width).toBe(120);
    expect(height).toBe(80);

    await expect(popupPage.getByTestId("capture-success")).toContainText("120 x 80 px");
  } finally {
    await context.close();
  }
});

test("AS_540_region_selection_respects_device_pixel_ratio_when_cropping", async () => {
  const { context, extensionId } = await launchExtension();

  try {
    const devicePixelRatio = 2;
    const { popupPage, naturalWidth, naturalHeight } = await setupCapturedPopup(
      context,
      extensionId,
      devicePixelRatio,
    );

    await popupPage.getByTestId("region-select-start-button").click();

    const image = popupPage.getByTestId("region-select-image");
    const box = await image.boundingBox();
    expect(box).toBeTruthy();

    // At devicePixelRatio 2, the CSS-pixel display size should be half the
    // physical-pixel natural size — proving the mapping this feature must
    // apply per F283's recorded devicePixelRatio.
    expect(Math.round(box!.width)).toBe(Math.round(naturalWidth / 2));
    expect(Math.round(box!.height)).toBe(Math.round(naturalHeight / 2));

    const startX = box!.x + 20;
    const startY = box!.y + 10;
    const endX = box!.x + 80;
    const endY = box!.y + 50;

    await popupPage.mouse.move(startX, startY);
    await popupPage.mouse.down();
    await popupPage.mouse.move(endX, endY, { steps: 5 });
    await popupPage.mouse.up();

    // 60 x 40 CSS-pixel selection at devicePixelRatio 2 => 120 x 80 physical.
    await expect(popupPage.getByTestId("region-select-readout")).toHaveText("60 x 40 px");

    await popupPage.getByTestId("region-crop-confirm-button").click();

    const croppedPreview = popupPage.getByTestId("capture-preview");
    await expect(croppedPreview).toBeVisible();
    const croppedDataUrl = await croppedPreview.getAttribute("src");
    const { width, height } = decodePngDimensions(croppedDataUrl!);
    expect(width).toBe(120);
    expect(height).toBe(80);
  } finally {
    await context.close();
  }
});

test("AS_540_escape_cancels_region_selection_without_a_stray_overlay_or_crash", async () => {
  const { context, extensionId } = await launchExtension();

  try {
    const { popupPage } = await setupCapturedPopup(context, extensionId, 1);

    await popupPage.getByTestId("region-select-start-button").click();
    await expect(popupPage.getByTestId("region-select-overlay")).toBeVisible();

    const image = popupPage.getByTestId("region-select-image");
    const box = await image.boundingBox();
    expect(box).toBeTruthy();

    // Start a drag, then cancel with Escape mid-selection.
    await popupPage.mouse.move(box!.x + 10, box!.y + 10);
    await popupPage.mouse.down();
    await popupPage.mouse.move(box!.x + 90, box!.y + 60, { steps: 3 });
    await popupPage.keyboard.press("Escape");
    await popupPage.mouse.up();

    // Overlay is gone entirely — no stray selection UI left mounted.
    await expect(popupPage.getByTestId("region-select-overlay")).toHaveCount(0);

    // Back to the plain full-tab capture state — no crash, capture still
    // available exactly as F283 left it (AS-539's path untouched).
    await expect(popupPage.getByTestId("capture-preview")).toBeVisible();
    await expect(popupPage.getByTestId("capture-success")).toHaveText("Screenshot captured.");
    await expect(popupPage.getByTestId("region-select-start-button")).toBeVisible();

    // Popup is still fully responsive after the cancel (no crash/frozen UI).
    await popupPage.getByTestId("region-select-start-button").click();
    await expect(popupPage.getByTestId("region-select-overlay")).toBeVisible();
  } finally {
    await context.close();
  }
});
