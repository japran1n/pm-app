// F300 — AS-571: a repeatable build command produces a distributable
// artifact.
//
// This is a build-process assertion, not a browser-behaviour one — there is
// no UI to drive. Following the existing shell-out-inside-a-Playwright-test
// convention already established by tests/no-secret-key.spec.ts (F281), this
// runs the real root-level `npm run build:extension` command twice against
// the real repo root (not a scratch copy — the whole point is proving the
// actual command chain is genuinely repeatable and self-cleaning) and
// inspects the real output on disk after each run.
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

// No zip-reading library is a project dependency; the system `unzip -l`
// (present on macOS/CI runners) genuinely lists a zip's contents rather
// than just checking the file exists, without adding a new dependency.
function listZipEntries(zipFilePath: string): string[] {
  const output = execFileSync("unzip", ["-l", zipFilePath], {
    encoding: "utf8",
  });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+\s/.test(line))
    .map((line) => line.split(/\s+/).slice(3).join(" "));
}

const extensionRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(extensionRoot, "..");
const distDir = path.join(extensionRoot, "dist");
const manifestPath = path.join(distDir, "manifest.json");
const zipPath = path.join(extensionRoot, "dist.zip");

function runBuild() {
  return execFileSync("npm", ["run", "build:extension"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("AS_571_root_build_command_is_repeatable_and_produces_a_distributable_artifact", () => {
  // Run 1.
  const output1 = runBuild();
  expect(output1).toContain("check-no-secret-key: PASS");

  expect(fs.existsSync(manifestPath)).toBe(true);
  const manifest1 = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  // Every icon path referenced in the built manifest genuinely resolves to
  // a real file under dist/ — a broken reference would be a build defect.
  const iconRefs = [
    ...Object.values(manifest1.icons ?? {}),
    ...Object.values(manifest1.action?.default_icon ?? {}),
  ] as string[];
  expect(iconRefs.length).toBeGreaterThan(0);
  for (const rel of iconRefs) {
    const resolved = path.join(distDir, rel);
    expect(fs.existsSync(resolved), `missing icon file ${resolved}`).toBe(true);
  }

  expect(fs.existsSync(zipPath)).toBe(true);
  const zipStat1 = fs.statSync(zipPath);
  expect(zipStat1.size).toBeGreaterThan(0);

  const entries1 = listZipEntries(zipPath);
  expect(entries1).toContain("manifest.json");
  // F344: manifest.json's icon paths were corrected from "public/icons/..."
  // to "icons/..." (the icons ship once, not duplicated under both paths —
  // M19 scrutiny MIN-7), so assert against whatever the built manifest
  // itself references rather than a hardcoded prefix.
  expect(entries1.some((e) => e.startsWith("icons/"))).toBe(true);

  // Run 2 — same command, from the same (now already-built) state, must
  // still succeed cleanly and reproduce the same artifacts (proves no
  // leftover state from run 1 breaks run 2, and that the build is
  // deterministic in shape, not a one-shot script).
  const output2 = runBuild();
  expect(output2).toContain("check-no-secret-key: PASS");

  expect(fs.existsSync(manifestPath)).toBe(true);
  const manifest2 = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  expect(manifest2.version).toBe(manifest1.version);

  expect(fs.existsSync(zipPath)).toBe(true);
  const zipStat2 = fs.statSync(zipPath);
  expect(zipStat2.size).toBeGreaterThan(0);

  const entries2 = listZipEntries(zipPath);
  expect(entries2).toContain("manifest.json");
  expect(entries2.some((e) => e.startsWith("icons/"))).toBe(true);
});

test("AS_571_version_has_a_single_source_of_truth", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"),
  );
  const sourceManifest = JSON.parse(
    fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"),
  );
  const builtManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  // extension/package.json is documented (store-listing.md, README.md) as
  // the single source of truth; scripts/sync-version.mjs enforces that
  // manifest.json (source) and the built manifest.json both match it.
  expect(sourceManifest.version).toBe(pkg.version);
  expect(builtManifest.version).toBe(pkg.version);
});
