// F280 (AS-531): produce a zip artifact of dist/ alongside the loadable
// unpacked directory. Chrome Web Store submission (a later, out-of-scope
// step per tech-decisions.md) needs a zip; the unpacked dist/ is what
// Playwright and `chrome://extensions` load-unpacked use directly.
//
// archiver@8 ships as pure ESM with a class-based API (`ZipArchive`)
// replacing the older `archiver(format, opts)` factory function. Verified
// against `node_modules/archiver` (installed 8.0.0, `npm view archiver
// version` -> 8.0.0) and its source (lib/core.js) as of 2026-08-19.
import { createWriteStream, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ZipArchive } from "archiver";

const distDir = resolve(import.meta.dirname, "..", "dist");
const outFile = resolve(import.meta.dirname, "..", "dist.zip");

if (!existsSync(distDir)) {
  console.error("dist/ not found — run vite build first");
  process.exit(1);
}

const output = createWriteStream(outFile);
const archive = new ZipArchive({ zlib: { level: 9 } });

output.on("close", () => {
  console.log(`Wrote ${outFile} (${archive.pointer()} bytes)`);
});

archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);
archive.directory(distDir, false);
archive.finalize();
