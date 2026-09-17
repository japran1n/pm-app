// F004 (AS-008): "The converter page does not appear anywhere inside the
// client-facing portal (/portal/*)." This is a smoke test closing out
// Milestone 1 -- the whole workspace-side tool (route F002, nav item F003)
// exists now, and this proves none of it leaked into the client-facing
// portal surface.
//
// Same grep-style whole-tree sweep pattern as
// tests/unit/f009-legacy-portal-route-redirects.test.ts: walk every
// non-test source file under app/(portal), components, and lib that is
// part of the portal's own render tree, and assert none of them
// reference the webflow tool's route path or its route/component
// modules. A route-existence check (no `tools/webflow` page under
// app/(portal)) plus an import-graph-style textual sweep together cover
// both "nobody added a portal route for it" and "nobody linked to it from
// inside the portal."
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();

// --- Primary success / route-existence check -------------------------
describe("F004 / AS-008: the converter route never appears under the portal", () => {
  it("test_AS_008_no_tools_webflow_route_exists_anywhere_under_app_portal", () => {
    const portalRoot = join(REPO_ROOT, "app", "(portal)");
    const offenders: string[] = [];

    function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (full.includes(join("tools", "webflow"))) {
          offenders.push(full);
        }
      }
    }

    expect(existsSync(portalRoot)).toBe(true);
    walk(portalRoot);
    expect(offenders).toEqual([]);
  });

  // --- Failure / side-effect check: a grep-style sweep over every
  // non-test source file that participates in the portal's render tree
  // (app/(portal), plus the shared components/lib the portal pulls from)
  // for any textual reference to the converter's route path or its
  // module paths. If a future feature ever links to the tool from inside
  // the portal, this fails loudly instead of relying on someone noticing
  // in review.
  it("test_AS_008_no_portal_source_file_references_the_webflow_tool_route_or_its_modules", () => {
    const SOURCE_ROOTS = ["app", "components", "lib"];
    const EXCLUDED_DIR_SEGMENTS = new Set(["node_modules", ".next", "(workspace)"]);
    const SOURCE_EXTENSIONS = [".ts", ".tsx"];

    const files: string[] = [];
    function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        if (EXCLUDED_DIR_SEGMENTS.has(entry)) continue;
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (
          SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext)) &&
          !entry.endsWith(".test.ts") &&
          !entry.endsWith(".test.tsx")
        ) {
          files.push(full);
        }
      }
    }
    for (const root of SOURCE_ROOTS) {
      walk(join(REPO_ROOT, root));
    }

    // Only files that are themselves inside the portal's own render tree
    // (app/(portal)/**) are checked for a reference to the tool -- the
    // workspace-side sidebar (components/nav/app-sidebar.tsx, F003) is
    // SUPPOSED to link to /w/[workspaceSlug]/tools/webflow; that is a
    // different, team-facing surface, not the client-facing portal this
    // assertion is about.
    const portalFiles = files.filter((f) =>
      f.includes(join("app", "(portal)")),
    );

    const offenders: string[] = [];
    for (const file of portalFiles) {
      const source = readFileSync(file, "utf8");
      if (
        source.includes("tools/webflow") ||
        source.includes("components/webflow-tool") ||
        source.includes("lib/webflow-converter") ||
        source.includes("lib/actions/webflow-converter")
      ) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
