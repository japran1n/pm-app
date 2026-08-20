// F285 — AS-545: flatten the base image plus every committed annotation
// operation onto a single new canvas and export it as one PNG. This is the
// only image this feature hands to the next stage — the pristine
// unannotated base image is never what gets returned from `flattenToPng`,
// so nothing downstream can accidentally keep using the original once
// annotations exist. See draw.ts's header for why this reuses the exact
// same per-operation drawing code the live interactive canvas uses.
import { drawAllOperations } from "./tools/draw";
import type { AnnotationOp, FlattenResult } from "./types";

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode the base image for annotation flattening."));
    img.src = dataUrl;
  });
}

export async function flattenToPng(
  baseImageDataUrl: string,
  ops: readonly AnnotationOp[],
): Promise<FlattenResult> {
  const img = await loadImage(baseImageDataUrl);
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context is unavailable in this environment.");
  }

  ctx.drawImage(img, 0, 0, width, height);
  drawAllOperations(ctx, ops);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width,
    height,
  };
}
