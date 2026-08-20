// F285 — AS-542 (arrow/rectangle/freehand/text tools all work), AS-543
// (undo/redo), AS-545 (the flattened-with-annotations PNG, not the
// pristine original, is what's held for the next stage).
//
// Follows the exact harness pattern documented in
// extension/tests/capture-visible-tab.spec.ts and reused by
// extension/tests/region-select.spec.ts: `chrome.tabs.captureVisibleTab` /
// `chrome.tabs.query` are stubbed (the only ungrantable piece — a real
// `activeTab` toolbar-icon click cannot be scripted by Playwright) with a
// real PNG Playwright itself screenshotted, so everything downstream —
// tool drawing, undo/redo, and the flatten step's real pixel output — is
// exercised for real through the real built popup UI.
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { Buffer } from "node:buffer";
import { PNG } from "pngjs";

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
  return { context, extensionId };
}

async function stubCaptureVisibleTab(page: Page, resolveWith: string) {
  await page.addInitScript((dataUrl) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chrome.tabs as any).captureVisibleTab = async () => dataUrl;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chrome.tabs as any).query = async () => [{ active: true, url: "http://example.com/" }];
    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
  }, resolveWith);
}

async function setupAnnotatingPopup(
  context: BrowserContext,
  extensionId: string,
): Promise<{ popupPage: Page }> {
  // A flat, solid-white base image, so any drawn pixel is trivially
  // distinguishable from the background by colour.
  const contentPage = await context.newPage();
  await contentPage.setViewportSize({ width: 300, height: 200 });
  await contentPage.setContent(
    "<html><body style='margin:0;background:#ffffff;width:300px;height:200px'></body></html>",
  );
  const screenshotBuffer = await contentPage.screenshot({ type: "png" });
  const capturedDataUrl = `data:image/png;base64,${screenshotBuffer.toString("base64")}`;

  const popupPage = await context.newPage();
  await stubCaptureVisibleTab(popupPage, capturedDataUrl);
  await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

  await popupPage.getByTestId("capture-button").click();
  await expect(popupPage.getByTestId("capture-preview")).toBeVisible({ timeout: 10_000 });
  await popupPage.getByTestId("annotate-start-button").click();
  await expect(popupPage.getByTestId("annotate-editor")).toBeVisible();

  return { popupPage };
}

function decodePngPixels(dataUrl: string): PNG {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  const buf = Buffer.from(base64, "base64");
  return PNG.sync.read(buf);
}

/** True if any pixel within the given CSS-pixel-space box (assumed == PNG
 * pixel space at devicePixelRatio 1, matching this test's setup) is not
 * pure white — i.e. something was actually drawn there. */
function hasNonWhitePixelInBox(
  png: PNG,
  box: { x: number; y: number; width: number; height: number },
): boolean {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(png.width, Math.ceil(box.x + box.width));
  const y1 = Math.min(png.height, Math.ceil(box.y + box.height));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (png.width * y + x) << 2;
      const r = png.data[idx];
      const g = png.data[idx + 1];
      const b = png.data[idx + 2];
      const a = png.data[idx + 3];
      if (a > 0 && (r !== 255 || g !== 255 || b !== 255)) {
        return true;
      }
    }
  }
  return false;
}

function isAllWhite(png: PNG): boolean {
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3];
    if (a > 0 && (png.data[i] !== 255 || png.data[i + 1] !== 255 || png.data[i + 2] !== 255)) {
      return false;
    }
  }
  return true;
}

async function getCanvasBox(popupPage: Page) {
  const canvas = popupPage.getByTestId("annotate-canvas");
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  return box!;
}

async function readCanvasDataUrl(popupPage: Page): Promise<string> {
  return popupPage.evaluate(() => {
    const canvas = document.querySelector('[data-testid="annotate-canvas"]') as HTMLCanvasElement;
    return canvas.toDataURL("image/png");
  });
}

test("AS_542_arrow_tool_draws_real_pixels_in_the_dragged_region", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const { popupPage } = await setupAnnotatingPopup(context, extensionId);
    await popupPage.getByTestId("annotate-tool-arrow").click();

    const box = await getCanvasBox(popupPage);
    const before = decodePngPixels(await readCanvasDataUrl(popupPage));
    expect(isAllWhite(before)).toBe(true);

    await popupPage.mouse.move(box.x + 20, box.y + 20);
    await popupPage.mouse.down();
    await popupPage.mouse.move(box.x + 120, box.y + 90, { steps: 8 });
    await popupPage.mouse.up();

    const after = decodePngPixels(await readCanvasDataUrl(popupPage));
    expect(hasNonWhitePixelInBox(after, { x: 20, y: 20, width: 100, height: 70 })).toBe(true);
  } finally {
    await context.close();
  }
});

test("AS_542_rectangle_tool_draws_real_pixels_in_the_dragged_region", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const { popupPage } = await setupAnnotatingPopup(context, extensionId);
    await popupPage.getByTestId("annotate-tool-rectangle").click();

    const box = await getCanvasBox(popupPage);
    await popupPage.mouse.move(box.x + 30, box.y + 30);
    await popupPage.mouse.down();
    await popupPage.mouse.move(box.x + 130, box.y + 100, { steps: 8 });
    await popupPage.mouse.up();

    const after = decodePngPixels(await readCanvasDataUrl(popupPage));
    expect(hasNonWhitePixelInBox(after, { x: 30, y: 30, width: 100, height: 70 })).toBe(true);
  } finally {
    await context.close();
  }
});

test("AS_542_freehand_tool_draws_real_pixels_along_the_dragged_path", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const { popupPage } = await setupAnnotatingPopup(context, extensionId);
    await popupPage.getByTestId("annotate-tool-freehand").click();

    const box = await getCanvasBox(popupPage);
    await popupPage.mouse.move(box.x + 40, box.y + 40);
    await popupPage.mouse.down();
    await popupPage.mouse.move(box.x + 60, box.y + 60, { steps: 4 });
    await popupPage.mouse.move(box.x + 80, box.y + 40, { steps: 4 });
    await popupPage.mouse.up();

    const after = decodePngPixels(await readCanvasDataUrl(popupPage));
    expect(hasNonWhitePixelInBox(after, { x: 35, y: 35, width: 50, height: 30 })).toBe(true);
  } finally {
    await context.close();
  }
});

test("AS_542_text_tool_places_a_real_focusable_input_and_renders_the_typed_text", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const { popupPage } = await setupAnnotatingPopup(context, extensionId);

    // Keyboard-only path: the "Add text" button is reachable and
    // activatable without any pointer coordinate at all.
    await popupPage.getByTestId("annotate-add-text-button").focus();
    await popupPage.keyboard.press("Enter");

    const input = popupPage.getByTestId("annotate-text-input");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await input.type("Hello");
    await popupPage.keyboard.press("Enter");

    await expect(input).toHaveCount(0);

    const after = decodePngPixels(await readCanvasDataUrl(popupPage));
    // Text is placed at the canvas centre by the keyboard path.
    expect(isAllWhite(after)).toBe(false);
  } finally {
    await context.close();
  }
});

test("AS_543_undo_and_redo_change_canvas_pixel_state_as_expected", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const { popupPage } = await setupAnnotatingPopup(context, extensionId);
    await popupPage.getByTestId("annotate-tool-rectangle").click();

    const box = await getCanvasBox(popupPage);
    const region = { x: 30, y: 30, width: 100, height: 70 };

    const beforeDraw = decodePngPixels(await readCanvasDataUrl(popupPage));
    expect(hasNonWhitePixelInBox(beforeDraw, region)).toBe(false);

    await popupPage.mouse.move(box.x + region.x, box.y + region.y);
    await popupPage.mouse.down();
    await popupPage.mouse.move(box.x + region.x + region.width, box.y + region.y + region.height, {
      steps: 6,
    });
    await popupPage.mouse.up();

    const afterDraw = decodePngPixels(await readCanvasDataUrl(popupPage));
    expect(hasNonWhitePixelInBox(afterDraw, region)).toBe(true);

    await expect(popupPage.getByTestId("annotate-undo")).toBeEnabled();
    await popupPage.getByTestId("annotate-undo").click();

    const afterUndo = decodePngPixels(await readCanvasDataUrl(popupPage));
    expect(hasNonWhitePixelInBox(afterUndo, region)).toBe(false);

    await expect(popupPage.getByTestId("annotate-redo")).toBeEnabled();
    await popupPage.getByTestId("annotate-redo").click();

    const afterRedo = decodePngPixels(await readCanvasDataUrl(popupPage));
    expect(hasNonWhitePixelInBox(afterRedo, region)).toBe(true);
  } finally {
    await context.close();
  }
});

test("AS_543_freehand_stroke_undoes_as_one_whole_stroke_not_point_by_point", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const { popupPage } = await setupAnnotatingPopup(context, extensionId);
    await popupPage.getByTestId("annotate-tool-freehand").click();

    const box = await getCanvasBox(popupPage);
    await popupPage.mouse.move(box.x + 40, box.y + 40);
    await popupPage.mouse.down();
    // Multiple intermediate points within a single stroke.
    await popupPage.mouse.move(box.x + 50, box.y + 45, { steps: 3 });
    await popupPage.mouse.move(box.x + 60, box.y + 50, { steps: 3 });
    await popupPage.mouse.move(box.x + 70, box.y + 40, { steps: 3 });
    await popupPage.mouse.up();

    const afterStroke = decodePngPixels(await readCanvasDataUrl(popupPage));
    expect(hasNonWhitePixelInBox(afterStroke, { x: 35, y: 35, width: 45, height: 20 })).toBe(true);

    // A single Undo click removes the ENTIRE stroke, not just its last
    // sampled point.
    await popupPage.getByTestId("annotate-undo").click();
    const afterOneUndo = decodePngPixels(await readCanvasDataUrl(popupPage));
    expect(hasNonWhitePixelInBox(afterOneUndo, { x: 35, y: 35, width: 45, height: 20 })).toBe(false);

    // And Undo is now disabled — there was only ever one committed
    // operation for the whole drag.
    await expect(popupPage.getByTestId("annotate-undo")).toBeDisabled();
  } finally {
    await context.close();
  }
});

test("AS_545_the_flattened_annotated_image_not_the_pristine_original_is_held_for_the_next_stage", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const { popupPage } = await setupAnnotatingPopup(context, extensionId);
    await popupPage.getByTestId("annotate-tool-rectangle").click();

    const box = await getCanvasBox(popupPage);
    await popupPage.mouse.move(box.x + 30, box.y + 30);
    await popupPage.mouse.down();
    await popupPage.mouse.move(box.x + 130, box.y + 100, { steps: 6 });
    await popupPage.mouse.up();

    await popupPage.getByTestId("annotate-confirm-button").click();

    // Editor is gone; the popup now shows the annotated result, not the
    // original capture preview.
    await expect(popupPage.getByTestId("annotate-editor")).toHaveCount(0);
    const annotatedPreview = popupPage.getByTestId("annotated-preview");
    await expect(annotatedPreview).toBeVisible();

    const annotatedDataUrl = await annotatedPreview.getAttribute("src");
    expect(annotatedDataUrl).toBeTruthy();
    const annotatedPng = decodePngPixels(annotatedDataUrl!);
    // Real annotation pixels are actually present in the held image —
    // not the pristine, all-white original.
    expect(hasNonWhitePixelInBox(annotatedPng, { x: 30, y: 30, width: 100, height: 70 })).toBe(true);
    expect(isAllWhite(annotatedPng)).toBe(false);

    // Popup.tsx calls `setAnnotatedResult(result)` with this exact same
    // `FlattenResult` object before rendering the "annotated" state (see
    // `handleAnnotationSubmit` in Popup.tsx) — the value shown here (and
    // asserted above to contain real annotation pixels, not the pristine
    // original) is byte-for-byte what `getAnnotatedResult()` in
    // capture/store.ts now returns for a later feature to read. There is
    // no separate derivation path that could diverge.
  } finally {
    await context.close();
  }
});
