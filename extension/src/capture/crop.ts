// F284 — AS-540: crop a full-tab capture down to a user-selected region.
//
// Design decision (see the F284 handoff "Decisions made" for the full
// reasoning): the region-selection UI lives in the popup, drawn over the
// *already-captured* static PNG image, not as a content-script overlay
// injected into the live page. That sidesteps the "the overlay must never
// appear in its own screenshot" requirement entirely — nothing is ever
// drawn on top of the live page at the moment `chrome.tabs.captureVisibleTab`
// fires, because selection only starts after that call has already
// resolved. It also means this feature adds zero new permissions or
// content_scripts entries (a live-page overlay would need to inject into
// arbitrary origins, which conflicts with tech-decisions.md's narrow
// `activeTab`-only stance).
//
// Crop math: `chrome.tabs.captureVisibleTab` returns a PNG at the OS's
// physical pixel density. A user drags a selection rectangle over the
// on-screen (CSS-pixel) preview image, which RegionSelect.tsx renders at a
// CSS-pixel size equal to `naturalPixelSize / devicePixelRatio` (i.e. the
// preview is shown "true to page size", matching how it looked on the
// live page before the physical-pixel capture was taken). Multiplying the
// CSS-pixel selection rect by `devicePixelRatio` (F283's recorded number)
// therefore maps it exactly onto the physical-pixel PNG's coordinate
// space — see https://developer.chrome.com/docs/extensions/reference/api/tabs
// (captureVisibleTab) and the F283 handoff's "Device pixel ratio recorded
// alongside the capture" decision, verified 2026-08-20.

export type PixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Turns two arbitrary drag points into a non-negative-size rect. */
export function normalizeRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
): PixelRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);
  return { x, y, width, height };
}

/** Maps a CSS-pixel rect (as drawn over the displayed preview image) onto
 * the physical-pixel coordinate space of the captured PNG, using F283's
 * recorded `devicePixelRatio`. Rounds to whole physical pixels since canvas
 * source rects operate on integer image data. */
export function cssRectToPhysicalRect(
  rect: PixelRect,
  devicePixelRatio: number,
): PixelRect {
  return {
    x: Math.round(rect.x * devicePixelRatio),
    y: Math.round(rect.y * devicePixelRatio),
    width: Math.round(rect.width * devicePixelRatio),
    height: Math.round(rect.height * devicePixelRatio),
  };
}

export type CropResult = {
  dataUrl: string;
  width: number;
  height: number;
};

/**
 * Crops a PNG data URL down to `physicalRect` (already in the source
 * image's own pixel space — see `cssRectToPhysicalRect`) using a canvas.
 * This is applied to F283's existing full-tab capture; it never triggers a
 * second `chrome.tabs.captureVisibleTab` call, so the "whole view" and
 * "region" capture paths cannot diverge — they share the same source PNG.
 *
 * F301 follow-up: genuinely context-agnostic now, not just assumed to be.
 * The original `HTMLCanvasElement` + `Image()` implementation (still used
 * below when `document` exists — i.e. when called from the popup, which is
 * still exercised directly by this module's own tests) does NOT work in
 * the background service worker, which now also needs to crop (see
 * `background/service-worker.ts`'s `runRegionCapture`) and has no DOM at
 * all — no `document.createElement`, no `Image()`. When `document` is
 * unavailable, this falls back to `OffscreenCanvas` + `createImageBitmap`,
 * which MV3 service workers DO support (verified against
 * https://developer.chrome.com/docs/extensions/reference/api/offscreen and
 * the current `OffscreenCanvas`/`createImageBitmap` MDN pages, which both
 * document worker-context — including dedicated/service worker —
 * availability; verified 2026-08-21). Both paths share the same
 * `clampRectToImage` bounds-checking and produce the exact same
 * `CropResult` shape, so callers never need to know or care which one ran.
 */
export async function cropDataUrlToRegion(
  dataUrl: string,
  physicalRect: PixelRect,
): Promise<CropResult> {
  if (typeof document === "undefined") {
    return cropDataUrlToRegionOffscreen(dataUrl, physicalRect);
  }

  const clamped = clampRectToImage(physicalRect, await loadImageSize(dataUrl));
  if (clamped.width <= 0 || clamped.height <= 0) {
    throw new Error(
      "Selected region has zero size after clamping to the captured image bounds.",
    );
  }

  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = clamped.width;
  canvas.height = clamped.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context is unavailable in this environment.");
  }

  ctx.drawImage(
    img,
    clamped.x,
    clamped.y,
    clamped.width,
    clamped.height,
    0,
    0,
    clamped.width,
    clamped.height,
  );

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: clamped.width,
    height: clamped.height,
  };
}

/** `document`-free crop path — see `cropDataUrlToRegion`'s doc comment. */
async function cropDataUrlToRegionOffscreen(
  dataUrl: string,
  physicalRect: PixelRect,
): Promise<CropResult> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const clamped = clampRectToImage(physicalRect, {
    width: bitmap.width,
    height: bitmap.height,
  });
  if (clamped.width <= 0 || clamped.height <= 0) {
    bitmap.close();
    throw new Error(
      "Selected region has zero size after clamping to the captured image bounds.",
    );
  }

  const canvas = new OffscreenCanvas(clamped.width, clamped.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("OffscreenCanvas 2D context is unavailable in this environment.");
  }

  ctx.drawImage(
    bitmap,
    clamped.x,
    clamped.y,
    clamped.width,
    clamped.height,
    0,
    0,
    clamped.width,
    clamped.height,
  );
  bitmap.close();

  const outBlob = await canvas.convertToBlob({ type: "image/png" });
  const outDataUrl = await blobToDataUrl(outBlob);

  return {
    dataUrl: outDataUrl,
    width: clamped.width,
    height: clamped.height,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to encode cropped image as a data URL."));
    reader.readAsDataURL(blob);
  });
}

function clampRectToImage(
  rect: PixelRect,
  imageSize: { width: number; height: number },
): PixelRect {
  const x = Math.max(0, Math.min(rect.x, imageSize.width));
  const y = Math.max(0, Math.min(rect.y, imageSize.height));
  const width = Math.max(0, Math.min(rect.width, imageSize.width - x));
  const height = Math.max(0, Math.min(rect.height, imageSize.height - y));
  return { x, y, width, height };
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode captured image for cropping."));
    img.src = dataUrl;
  });
}

async function loadImageSize(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  const img = await loadImage(dataUrl);
  return { width: img.naturalWidth, height: img.naturalHeight };
}
