// F300 (AS-571): generate simple placeholder PNG icons at the sizes Chrome
// requires for a MV3 manifest's `icons` field and toolbar `action.default_icon`
// (16x16, 48x48, 128x128 — verified via developer.chrome.com/docs/extensions/
// reference/manifest/icons, 2026-08-21). This is an internal QA tool, not a
// consumer product, so a simple flat-colour mark with a glyph is sufficient —
// no design tooling required, just draw pixels directly with pngjs (already a
// devDependency, used elsewhere in this workspace).
import { PNG } from "pngjs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = resolve(import.meta.dirname, "..", "public", "icons");

// Simple brand mark: a solid indigo rounded square with a white "bug" dot
// in the middle (this is a QA-feedback-capture tool) — legible at 16px.
const BG = { r: 0x4f, g: 0x46, b: 0xe5, a: 255 }; // indigo-600
const FG = { r: 0xff, g: 0xff, b: 0xff, a: 255 };

function makeIcon(size) {
  const png = new PNG({ width: size, height: size });
  const cornerRadius = Math.max(1, Math.round(size * 0.18));
  const dotRadius = Math.max(1, size * 0.22);
  const cx = size / 2;
  const cy = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;

      // Rounded-square mask: treat corners outside the radius as transparent.
      const inCornerBox =
        (x < cornerRadius || x >= size - cornerRadius) &&
        (y < cornerRadius || y >= size - cornerRadius);
      let opaque = true;
      if (inCornerBox) {
        const cornerCx = x < cornerRadius ? cornerRadius : size - cornerRadius;
        const cornerCy = y < cornerRadius ? cornerRadius : size - cornerRadius;
        const dx = x - cornerCx;
        const dy = y - cornerCy;
        if (dx * dx + dy * dy > cornerRadius * cornerRadius) {
          opaque = false;
        }
      }

      if (!opaque) {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
        continue;
      }

      const dx = x - cx;
      const dy = y - cy;
      const isDot = dx * dx + dy * dy <= dotRadius * dotRadius;
      const color = isDot ? FG : BG;
      png.data[idx] = color.r;
      png.data[idx + 1] = color.g;
      png.data[idx + 2] = color.b;
      png.data[idx + 3] = color.a;
    }
  }

  return png;
}

const sizes = [16, 48, 128];
for (const size of sizes) {
  const png = makeIcon(size);
  const outPath = resolve(OUT_DIR, `icon${size}.png`);
  writeFileSync(outPath, PNG.sync.write(png));
  console.log(`Wrote ${outPath}`);
}
