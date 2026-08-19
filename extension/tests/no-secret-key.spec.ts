// F281 — AS-538: the shipped extension bundle contains no secret key.
//
// Real automated check against the *built* dist/ output (not source),
// since tree-shaking/minification can behave differently than source. Runs
// scripts/check-no-secret-key.mjs (also wired into `npm run build`) and
// additionally proves the check is not vacuous by running it against a
// throwaway copy of dist/ with a fabricated secret-shaped string injected.
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const extensionRoot = path.resolve(import.meta.dirname, "..");
const distPath = path.join(extensionRoot, "dist");
const checkScript = path.join(extensionRoot, "scripts", "check-no-secret-key.mjs");

test("AS_538_built_bundle_has_no_secret_key", () => {
  if (!fs.existsSync(path.join(distPath, "manifest.json"))) {
    throw new Error(
      `Extension build not found at ${distPath}. Run "npm run build" in extension/ before this test.`,
    );
  }

  // Should pass against the real build.
  expect(() =>
    execFileSync("node", [checkScript], { cwd: extensionRoot }),
  ).not.toThrow();
});

test("AS_538_the_check_actually_detects_a_leaked_secret_key", () => {
  // Prove the check isn't a no-op: copy dist/ to a scratch dir, inject a
  // fabricated secret-key-shaped string, point a second run of the checker
  // at that scratch dist/, and confirm it fails.
  const scratchRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pm-app-ext-secret-check-"),
  );
  const scratchExtensionDir = path.join(scratchRoot, "extension");
  const scratchDist = path.join(scratchExtensionDir, "dist");
  const scratchScripts = path.join(scratchExtensionDir, "scripts");
  fs.mkdirSync(scratchDist, { recursive: true });
  fs.mkdirSync(scratchScripts, { recursive: true });
  fs.copyFileSync(
    checkScript,
    path.join(scratchScripts, "check-no-secret-key.mjs"),
  );
  fs.writeFileSync(
    path.join(scratchDist, "leaked.js"),
    'const k = "sb_secret_thisShouldNeverShipToABrowserBundle123456";',
  );

  expect(() =>
    execFileSync(
      "node",
      [path.join(scratchScripts, "check-no-secret-key.mjs")],
      { cwd: scratchExtensionDir },
    ),
  ).toThrow();

  fs.rmSync(scratchRoot, { recursive: true, force: true });
});
