// F298 — AS-568: the extension declares the narrowest permissions that
// support its shipped features, each justified in extension/PERMISSIONS.md.
//
// Static, real-file check against the *built* manifest.json (not source, in
// case a future build step ever rewrites it) — asserts the exact minimal
// permission set this mission's features actually use (activeTab, storage,
// scripting; host_permissions scoped to the app's own localhost origin; one
// content_scripts entry scoped to the one-time session-handoff page) and
// that the broad `<all_urls>` host permission never appears anywhere in the
// manifest.
import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { loadEnv } from "vite";

const extensionRoot = path.resolve(import.meta.dirname, "..");
const distManifestPath = path.join(extensionRoot, "dist", "manifest.json");
const sourceManifestPath = path.join(extensionRoot, "manifest.json");
const permissionsDocPath = path.join(extensionRoot, "PERMISSIONS.md");

// F344 (M19 scrutiny BLOCKER-5 / FU-4, AS-571): read the same VITE_APP_URL
// vite.config.ts used to build dist/manifest.json (via the same `loadEnv`
// mechanism, "production" mode matching `vite build`'s default) so this
// suite asserts the built manifest's origins actually match the *configured*
// app origin — not merely that the source and built copies agree with each
// other, which is the gap BLOCKER-5 found (both copies could be, and were,
// hardcoded to the wrong origin in lockstep).
const builtEnv = loadEnv("production", extensionRoot, "");
const configuredOrigin = new URL(builtEnv.VITE_APP_URL).origin;

test.beforeAll(() => {
  if (!fs.existsSync(distManifestPath)) {
    throw new Error(
      `Extension build not found at ${distManifestPath}. Run "npm run build" in extension/ before this test.`,
    );
  }
});

test("AS_568_built_manifest_declares_only_the_minimal_justified_permission_set", () => {
  const manifest = JSON.parse(fs.readFileSync(distManifestPath, "utf8"));

  // Exact set — nothing broader than what F280/F281/F287 actually shipped.
  expect(new Set(manifest.permissions)).toEqual(
    new Set(["activeTab", "storage", "scripting"]),
  );

  // Exactly one host_permissions entry, scoped to the app's own origin —
  // never a wildcard or a second, broader origin.
  expect(manifest.host_permissions).toEqual([`${configuredOrigin}/*`]);

  // Exactly one content_scripts entry, scoped to the one-time
  // session-handoff path — not a general page match.
  expect(manifest.content_scripts).toHaveLength(1);
  expect(manifest.content_scripts[0].matches).toEqual([
    `${configuredOrigin}/extension-connect*`,
  ]);
});

test("AS_571_built_manifest_origins_are_derived_from_the_configured_VITE_APP_URL", () => {
  // Regression test for M19 BLOCKER-5: a build must actually rewrite the
  // manifest's origin-scoped fields from VITE_APP_URL, not ship a
  // hardcoded localhost origin regardless of configuration. This asserts
  // against the independently-computed `configuredOrigin` (read straight
  // from .env via the same loadEnv mechanism vite.config.ts uses), so it
  // cannot pass merely because source and dist manifests agree with each
  // other while both are wrong.
  const manifest = JSON.parse(fs.readFileSync(distManifestPath, "utf8"));

  expect(manifest.host_permissions).toEqual([`${configuredOrigin}/*`]);
  for (const script of manifest.content_scripts ?? []) {
    for (const match of script.matches ?? []) {
      expect(match.startsWith(configuredOrigin)).toBe(true);
    }
  }
  if (manifest.web_accessible_resources) {
    for (const resource of manifest.web_accessible_resources) {
      for (const match of resource.matches ?? []) {
        expect(match.startsWith(configuredOrigin)).toBe(true);
      }
    }
  }
});

test("AS_568_all_urls_never_appears_anywhere_in_the_manifest", () => {
  const manifest = JSON.parse(fs.readFileSync(distManifestPath, "utf8"));
  const serialized = JSON.stringify(manifest);
  expect(serialized).not.toContain("<all_urls>");
  expect(serialized).not.toContain("*://*/*");
});

test("AS_568_source_and_built_manifest_declare_the_same_permission_set", () => {
  // Guards against the source manifest.json (which this test suite's other
  // tests and this feature's audit are read against) drifting from what
  // vite/crxjs actually emits into dist/ at build time.
  const source = JSON.parse(fs.readFileSync(sourceManifestPath, "utf8"));
  const built = JSON.parse(fs.readFileSync(distManifestPath, "utf8"));
  expect(new Set(built.permissions)).toEqual(new Set(source.permissions));
  expect(built.host_permissions).toEqual(source.host_permissions);
  expect(built.content_scripts?.[0]?.matches).toEqual(
    source.content_scripts?.[0]?.matches,
  );
});

test("AS_568_every_declared_permission_has_a_written_justification", () => {
  expect(fs.existsSync(permissionsDocPath)).toBe(true);
  const doc = fs.readFileSync(permissionsDocPath, "utf8").toLowerCase();
  const manifest = JSON.parse(fs.readFileSync(distManifestPath, "utf8"));

  for (const permission of manifest.permissions as string[]) {
    expect(doc).toContain(permission.toLowerCase());
  }
  expect(doc).toContain("host_permissions");
  expect(doc).toContain("content_scripts");
  expect(doc).toContain("extension-connect");
  // Plain-language "can/cannot see" disclosure section, per the spec's
  // explicit third bullet.
  expect(doc).toMatch(/can (only )?see|cannot see|can't see/);
});
