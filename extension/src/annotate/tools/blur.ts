// F286 — AS-544: destructive region pixelation.
//
// Chosen block size: 16 physical (base-image) pixels per side. Reasoning
// (see the feature's clarification § "simpler, more private option"):
// pixelation, not a gaussian/soft blur, was chosen because a soft blur is a
// convolution and can sometimes be partially reversed by deconvolution —
// coarse block-averaging genuinely discards information (every pixel in a
// block becomes indistinguishable from every other pixel in that block, so
// there is nothing left to invert). 16px is coarse enough to make small
// text (email addresses, API tokens, usernames) in a typical browser
// screenshot fully illegible — a single lowercase character is usually
// well under 16px wide/tall at normal browser zoom — while still being
// small enough that a user redacting, say, a 200x40px area gets a
// recognisable "this region was redacted" pixelated block rather than one
// giant flat rectangle that could be confused with an opaque fill (which
// would visually look identical to a drawn rectangle and undermine the
// "genuinely pixelated, not just covered" guarantee the tests check for).
export const BLUR_BLOCK_SIZE = 16;

import type { BlurOp } from "../types";

/**
 * Destructively pixelates the rectangular region described by `op` in
 * place on `ctx`. Reads whatever pixels are currently on the canvas at
 * that region (base image plus any operations already drawn before this
 * one in the same `drawAllOperations` replay) via `getImageData`, replaces
 * every block of `op.blockSize` x `op.blockSize` pixels with that block's
 * average colour, and writes the result back with `putImageData`.
 *
 * This is NOT a shape drawn on top of the image — `getImageData` /
 * `putImageData` operate on the canvas's actual raster pixel buffer, so
 * the averaging is a genuine, information-destroying transform of the
 * pixels themselves. Both the live interactive canvas (`canvas.tsx`'s
 * redraw effect) and the final flatten (`flatten.ts`) call this exact same
 * function through `drawAllOperations`/`drawOperation`, so the exported
 * PNG's pixels in the blurred region are byte-for-byte the same
 * block-averaged pixels the user saw live — there is no separate,
 * non-destructive "preview" representation that a later step could peel
 * off to reveal the original pixels.
 */
export function drawBlurRegion(ctx: CanvasRenderingContext2D, op: BlurOp): void {
  const canvas = ctx.canvas;
  const rawX = Math.min(op.from.x, op.to.x);
  const rawY = Math.min(op.from.y, op.to.y);
  const rawWidth = Math.abs(op.to.x - op.from.x);
  const rawHeight = Math.abs(op.to.y - op.from.y);
  if (rawWidth <= 0 || rawHeight <= 0) return;

  // Clamp to canvas bounds and integer pixel coordinates — getImageData
  // requires integer, in-bounds arguments.
  const x = Math.max(0, Math.floor(rawX));
  const y = Math.max(0, Math.floor(rawY));
  const width = Math.max(0, Math.min(Math.ceil(rawWidth), canvas.width - x));
  const height = Math.max(0, Math.min(Math.ceil(rawHeight), canvas.height - y));
  if (width <= 0 || height <= 0) return;

  const imageData = ctx.getImageData(x, y, width, height);
  const data = imageData.data;
  const blockSize = op.blockSize;

  for (let blockY = 0; blockY < height; blockY += blockSize) {
    for (let blockX = 0; blockX < width; blockX += blockSize) {
      const blockWidth = Math.min(blockSize, width - blockX);
      const blockHeight = Math.min(blockSize, height - blockY);

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      let count = 0;
      for (let py = 0; py < blockHeight; py++) {
        for (let px = 0; px < blockWidth; px++) {
          const idx = ((blockY + py) * width + (blockX + px)) * 4;
          sumR += data[idx];
          sumG += data[idx + 1];
          sumB += data[idx + 2];
          sumA += data[idx + 3];
          count++;
        }
      }
      if (count === 0) continue;
      const avgR = Math.round(sumR / count);
      const avgG = Math.round(sumG / count);
      const avgB = Math.round(sumB / count);
      const avgA = Math.round(sumA / count);

      for (let py = 0; py < blockHeight; py++) {
        for (let px = 0; px < blockWidth; px++) {
          const idx = ((blockY + py) * width + (blockX + px)) * 4;
          data[idx] = avgR;
          data[idx + 1] = avgG;
          data[idx + 2] = avgB;
          data[idx + 3] = avgA;
        }
      }
    }
  }

  ctx.putImageData(imageData, x, y);
}
