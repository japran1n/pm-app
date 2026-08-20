// F300 (AS-571): "the version read from one place" — package.json is the
// single source of truth for the extension's version. manifest.json's
// `version` field is a hand-authored MV3 requirement (Chrome reads
// manifest.json directly, not package.json), so it cannot be removed, but
// it must never be independently edited: this script overwrites it from
// package.json on every build, so the two numbers can never drift.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pkgPath = resolve(root, "package.json");
const manifestPath = resolve(root, "manifest.json");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.version !== pkg.version) {
  manifest.version = pkg.version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    `sync-version: updated manifest.json version to ${pkg.version} (from package.json)`,
  );
} else {
  console.log(`sync-version: manifest.json already at ${pkg.version} — no change.`);
}
