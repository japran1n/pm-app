import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// AS-002: workspace-by-slug lookup is memoised per request instead of every
// layout/page in a nested route resolving the same slug with its own query.
//
// What this test proves and what it does not (same caveat as F001's
// tests/unit/pf-current-user-cache.test.ts): under plain Vitest there is no
// active Next.js per-request `cache()` dispatcher, so calling
// `getWorkspaceBySlug` twice in a unit test does NOT dedupe to one Supabase
// call -- asserting otherwise here would either fail honestly or only be
// made to pass by mocking `cache()` itself, which would test the mock, not
// production behaviour. The guarantee that two calls in one real request
// collapse to one round trip comes from React's own `cache()` +
// Next.js's per-request dispatcher (see lib/auth/current-user.ts's header
// comment for the full reasoning this file also relies on). What IS
// verifiable statically, and is what this suite checks:
//
// 1. Exactly one `cache()`-wrapped `getWorkspaceBySlug` is exported from
//    lib/queries/workspaces.ts (no call site is allowed to keep its own
//    private copy once F003/F007 wire it in).
// 2. It selects the union of every column an existing call site reads
//    today (id, name, slug, logo_url) so later swapping a narrower-select
//    caller onto it cannot change what that caller reads.
// 3. It does NOT contain the `workspace_slug_history` fallback query --
//    that's a redirect decision that belongs at the one call site
//    (the top-level workspace layout) that has it today, not baked into
//    the shared helper where it would change every other caller's
//    behaviour (AS-025).

const REPO_ROOT = join(__dirname, "..", "..");
const SOURCE_PATH = join(REPO_ROOT, "lib", "queries", "workspaces.ts");

describe("AS-002: request-scoped workspace-by-slug helper", () => {
  it("exports exactly one cache()-wrapped getWorkspaceBySlug", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");

    const matches = [
      ...source.matchAll(
        /export\s+const\s+getWorkspaceBySlug\s*=\s*cache\(\s*async\s+function\s+getWorkspaceBySlug/g,
      ),
    ];

    expect(matches).toHaveLength(1);
  });

  it("queries the workspaces table by slug and selects the union of columns every existing call site reads", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");

    const fnStart = source.indexOf("export const getWorkspaceBySlug");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = source.slice(fnStart, fnStart + 800);

    expect(fnBody).toMatch(/\.from\(\s*"workspaces"\s*\)/);
    expect(fnBody).toMatch(/\.select\(\s*"id, name, slug, logo_url"\s*\)/);
    expect(fnBody).toMatch(/\.eq\(\s*"slug",\s*slug\s*\)/);
    expect(fnBody).toMatch(/\.maybeSingle\(\)/);
  });

  it("does not fold the workspace_slug_history redirect lookup into the shared helper's function body", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");

    const fnStart = source.indexOf("export const getWorkspaceBySlug");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = source.slice(fnStart);

    expect(fnBody).not.toMatch(/workspace_slug_history/);
  });

  it("uses the shared request-scoped Supabase client from F001 rather than constructing its own", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");

    expect(source).toMatch(
      /import\s*\{\s*getRequestClient\s*\}\s*from\s*["']@\/lib\/auth\/current-user["']/,
    );
  });
});
