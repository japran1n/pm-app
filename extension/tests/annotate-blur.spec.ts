// F286 — AS-544: a region can be blurred before sending. Follows the exact
// harness pattern established in annotate.spec.ts (F285): a real PNG
// Playwright screenshotted itself is fed through `chrome.tabs.captureVisibleTab`,
// then the real built popup UI is driven end to end and the actual PNG
// pixel bytes are decoded via `pngjs` — no mocking of the drawing/flatten
// code itself.
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { Buffer } from "node:buffer";
import { PNG } from "pngjs";

const distPath = path.resolve(import.meta.dirname, "..", "dist");
const BLUR_BLOCK_SIZE = 16;

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

// F287-followup (select-portion-first flow, region-overlay.ts): this
// file is not about the drag-select mechanics themselves (see
// capture-visible-tab.spec.ts for the real end-to-end drag test) — it
// only needs a stable, deterministic path to a cropped screenshot, so
// `chrome.scripting.executeScript` (which region-overlay.ts's
// `selectRegionOnActiveTab()` calls) is stubbed to resolve immediately
// with a rect covering the whole captured image. crop.ts's own
// `clampRectToImage` clamps an oversized rect down to the real image
// bounds, so the "cropped" result is pixel-identical to the full
// screenshot below — preserving every existing pixel-based assertion in
// this file unchanged.
async function stubCaptureVisibleTab(page: Page, resolveWith: string) {
  await page.addInitScript((dataUrl) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chrome.tabs as any).captureVisibleTab = async () => dataUrl;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chrome.tabs as any).query = async () => [{ active: true, id: 1, url: "http://example.com/" }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chrome.scripting as any).executeScript = async () => [
      { result: { ok: true, rect: { x: 0, y: 0, width: 99999, height: 99999 } } },
    ];
    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
  }, resolveWith);
}

async function setupAnnotatingPopup(
  context: BrowserContext,
  extensionId: string,
): Promise<{ popupPage: Page }> {
  // A flat, solid-white base image, so any drawn/blurred pixel is trivially
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

function pixelAt(png: PNG, x: number, y: number): [number, number, number, number] {
  const idx = (png.width * y + x) << 2;
  return [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]];
}

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
      const [r, g, b, a] = pixelAt(png, x, y);
      if (a > 0 && (r !== 255 || g !== 255 || b !== 255)) {
        return true;
      }
    }
  }
  return false;
}

/** True if every pixel within the given box has the identical colour —
 * proving a genuine block-average fill happened (real pixelation), not
 * just "some pixels changed" (which a semi-transparent overlay could also
 * produce while leaving pixel-to-pixel variation intact). */
function isUniformBox(png: PNG, box: { x: number; y: number; width: number; height: number }): boolean {
  const x0 = Math.floor(box.x);
  const y0 = Math.floor(box.y);
  const x1 = Math.min(png.width, Math.ceil(box.x + box.width));
  const y1 = Math.min(png.height, Math.ceil(box.y + box.height));
  const [r0, g0, b0, a0] = pixelAt(png, x0, y0);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const [r, g, b, a] = pixelAt(png, x, y);
      if (r !== r0 || g !== g0 || b !== b0 || a !== a0) return false;
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

/** Fills a region with a high-contrast, non-white, non-uniform colour by
 * dragging the rectangle tool across it and confirming a stroke is drawn —
 * used so the blur test has real content worth destroying (a flat-white
 * base image alone can't prove pixels were genuinely block-averaged vs.
 * just "still white"). */
async function drawHighContrastRectangle(
  popupPage: Page,
  box: { x: number; y: number },
  region: { x: number; y: number; width: number; height: number },
) {
  await popupPage.getByTestId("annotate-tool-rectangle").click();
  // Use the thickest stroke so the drawn rectangle's border fills a large,
  // dense portion of the region with solid colour.
  await popupPage.getByTestId("annotate-stroke-width").fill("20");
  await popupPage.mouse.move(box.x + region.x, box.y + region.y);
  await popupPage.mouse.down();
  await popupPage.mouse.move(box.x + region.x + region.width, box.y + region.y + region.height, {
    steps: 8,
  });
  await popupPage.mouse.up();
}

async function dragBlurRegion(
  popupPage: Page,
  box: { x: number; y: number },
  region: { x: number; y: number; width: number; height: number },
) {
  await popupPage.getByTestId("annotate-tool-blur").click();
  await popupPage.mouse.move(box.x + region.x, box.y + region.y);
  await popupPage.mouse.down();
  await popupPage.mouse.move(box.x + region.x + region.width, box.y + region.y + region.height, {
    steps: 8,
  });
  await popupPage.mouse.up();
}

test("AS_544_blur_tool_pixelates_the_dragged_region_into_uniform_blocks_not_a_translucent_overlay", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const { popupPage } = await setupAnnotatingPopup(context, extensionId);
    const box = await getCanvasBox(popupPage);
    const region = { x: 30, y: 30, width: 96, height: 64 };

    await drawHighContrastRectangle(popupPage, box, region);
    const beforeBlur = decodePngPixels(await readCanvasDataUrl(popupPage));
    expect(hasNonWhitePixelInBox(beforeBlur, region)).toBe(true);
    // The freshly drawn rectangle stroke is NOT uniform across the whole
    // region (it's a thin-ish border, not a solid fill) — this is the
    // baseline we're about to destroy with blur.
    expect(isUniformBox(beforeBlur, region)).toBe(false);

    await dragBlurRegion(popupPage, box, region);
    const afterBlur = decodePngPixels(await readCanvasDataUrl(popupPage));

    // Every single BLUR_BLOCK_SIZE x BLUR_BLOCK_SIZE block fully inside the
    // blurred region is now a uniform colour — real block-averaging
    // happened, not a drawn rectangle merely sitting on top.
    // Checked with a small inset margin: the mouse-driven drag region and
    // the implementation's own `Math.floor`-based block grid can differ by
    // a sub-pixel amount (fractional CSS mouse coordinates rounded to
    // integer canvas pixels), so a nominal 16x16 box checked at its exact
    // boundary can straddle two real blocks by a pixel. Insetting by 3px on
    // each side keeps the checked area safely inside a single real block
    // regardless of that drift, while still proving genuine block-uniform
    // averaging over a large majority of each block.
    const INSET = 3;
    let checkedAtLeastOneBlock = false;
    for (let by = region.y; by + BLUR_BLOCK_SIZE <= region.y + region.height; by += BLUR_BLOCK_SIZE) {
      for (let bx = region.x; bx + BLUR_BLOCK_SIZE <= region.x + region.width; bx += BLUR_BLOCK_SIZE) {
        expect(
          isUniformBox(afterBlur, {
            x: bx + INSET,
            y: by + INSET,
            width: BLUR_BLOCK_SIZE - 2 * INSET,
            height: BLUR_BLOCK_SIZE - 2 * INSET,
          }),
        ).toBe(true);
        checkedAtLeastOneBlock = true;
      }
    }
    expect(checkedAtLeastOneBlock).toBe(true);

    // And the blurred result measurably differs from the pre-blur pixels
    // (the region actually changed, it isn't a no-op).
    const [rBefore, gBefore, bBefore] = pixelAt(beforeBlur, region.x + 2, region.y + 2);
    const [rAfter, gAfter, bAfter] = pixelAt(afterBlur, region.x + 2, region.y + 2);
    const changed = rBefore !== rAfter || gBefore !== gAfter || bBefore !== bAfter;
    expect(changed).toBe(true);

    // --- Live-session undo (while still editing) restores pre-blur pixels ---
    await expect(popupPage.getByTestId("annotate-undo")).toBeEnabled();
    await popupPage.getByTestId("annotate-undo").click();
    const afterUndo = decodePngPixels(await readCanvasDataUrl(popupPage));
    expect(isUniformBox(afterUndo, region)).toBe(false);
    const [rUndo, gUndo, bUndo] = pixelAt(afterUndo, region.x + 2, region.y + 2);
    expect([rUndo, gUndo, bUndo]).toEqual([rBefore, gBefore, bBefore]);
  } finally {
    await context.close();
  }
});

test("AS_544_blurred_region_is_genuinely_destroyed_in_the_exported_flattened_png", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const { popupPage } = await setupAnnotatingPopup(context, extensionId);
    const box = await getCanvasBox(popupPage);
    const region = { x: 30, y: 30, width: 96, height: 64 };

    await drawHighContrastRectangle(popupPage, box, region);
    const beforeBlur = decodePngPixels(await readCanvasDataUrl(popupPage));

    await dragBlurRegion(popupPage, box, region);

    // Confirm/export — same mechanism F285 built (AS-545), the flattened
    // PNG is what gets attached.
    await popupPage.getByTestId("annotate-confirm-button").click();
    await expect(popupPage.getByTestId("annotate-editor")).toHaveCount(0);
    const annotatedPreview = popupPage.getByTestId("annotated-preview");
    await expect(annotatedPreview).toBeVisible();
    const annotatedDataUrl = await annotatedPreview.getAttribute("src");
    expect(annotatedDataUrl).toBeTruthy();
    const exported = decodePngPixels(annotatedDataUrl!);

    // The exported PNG bytes themselves — not the live canvas, the actual
    // attached artifact — show the coarse block-averaged pattern: every
    // full block in the region is uniform.
    const INSET = 3;
    let checkedAtLeastOneBlock = false;
    for (let by = region.y; by + BLUR_BLOCK_SIZE <= region.y + region.height; by += BLUR_BLOCK_SIZE) {
      for (let bx = region.x; bx + BLUR_BLOCK_SIZE <= region.x + region.width; bx += BLUR_BLOCK_SIZE) {
        expect(
          isUniformBox(exported, {
            x: bx + INSET,
            y: by + INSET,
            width: BLUR_BLOCK_SIZE - 2 * INSET,
            height: BLUR_BLOCK_SIZE - 2 * INSET,
          }),
        ).toBe(true);
        checkedAtLeastOneBlock = true;
      }
    }
    expect(checkedAtLeastOneBlock).toBe(true);

    // The original pre-blur pixel value cannot be recovered from the
    // exported bytes: sample several points within one block and confirm
    // they're now all equal to each other (average), even though the
    // pre-blur image had genuine variation at those same points (proving
    // detail was actually destroyed, not just visually covered).
    // Chosen away from the drawn rectangle's corners (where the horizontal
    // and vertical border strokes overlap and make the whole block a
    // uniform border colour even before blurring) — centred along the top
    // edge, this block straddles the border/non-border boundary, so it
    // genuinely varies pre-blur.
    const sampleBlock = {
      x: region.x + Math.round(region.width / 2) - BLUR_BLOCK_SIZE / 2,
      y: region.y,
      width: BLUR_BLOCK_SIZE,
      height: BLUR_BLOCK_SIZE,
    };
    const beforeSamples = [
      pixelAt(beforeBlur, sampleBlock.x + 1, sampleBlock.y + 1),
      pixelAt(beforeBlur, sampleBlock.x + BLUR_BLOCK_SIZE - 2, sampleBlock.y + 1),
      pixelAt(beforeBlur, sampleBlock.x + 1, sampleBlock.y + BLUR_BLOCK_SIZE - 2),
    ];
    const beforeVaries = beforeSamples.some(
      ([r, g, b]) => r !== beforeSamples[0][0] || g !== beforeSamples[0][1] || b !== beforeSamples[0][2],
    );
    expect(beforeVaries).toBe(true);
    expect(
      isUniformBox(exported, {
        x: sampleBlock.x + 3,
        y: sampleBlock.y + 3,
        width: sampleBlock.width - 6,
        height: sampleBlock.height - 6,
      }),
    ).toBe(true);
  } finally {
    await context.close();
  }
});
