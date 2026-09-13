import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// AS-003: identity resolution is memoised per request instead of every call
// site hitting `supabase.auth.getUser()` again.
//
// What this test proves and what it does not: under plain Vitest (no
// Next.js request runtime), React's `cache()` has no active per-request
// dispatcher, so it falls back to calling the wrapped function directly
// every time (see the header comment in lib/auth/current-user.ts and
// lib/actions/authz.ts). A test that calls the helper twice and asserts
// `getUser` ran once would therefore FAIL honestly under Vitest and would
// only be made to "pass" by mocking `cache()` itself -- which proves
// nothing about production behaviour. Instead this test makes two
// structural assertions that hold regardless of runtime:
//
// 1. There is exactly one `cache()`-wrapped identity resolver in the
//    codebase (lib/auth/current-user.ts's `getCurrentUser`) -- no call
//    site is allowed to declare its own private copy.
// 2. That resolver calls `auth.getUser()`, and `getSession()` never
//    appears anywhere as a replacement for it (caching a verified result
//    is fine; skipping verification is not).
//
// It does NOT prove that two calls in one real request dedupe to one
// network round trip -- that guarantee comes from React's own `cache()`
// implementation and Next.js's per-request dispatcher, not from this repo,
// and can only be observed against a running Next.js request (out of scope
// for a unit test that must not start a dev server).

const SCAN_DIRS = ["lib", "app", "components"];
const SCAN_EXTENSIONS = [".ts", ".tsx"];

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else if (SCAN_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

const REPO_ROOT = join(__dirname, "..", "..");

describe("AS-003: request-scoped current-user helper", () => {
  it("defines exactly one cache()-wrapped identity resolver in the codebase", () => {
    const files = SCAN_DIRS.flatMap((dir) => collectFiles(join(REPO_ROOT, dir)));

    const wrappers: { file: string; name: string }[] = [];
    const cacheWrapPattern =
      /(?:export\s+)?const\s+(\w+)\s*=\s*cache\(\s*async\s+function\s+\w+/g;

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      let match: RegExpExecArray | null;
      cacheWrapPattern.lastIndex = 0;
      while ((match = cacheWrapPattern.exec(content)) !== null) {
        // Only count resolvers that actually call auth.getUser or
        // auth.getSession -- i.e. identity resolvers, not other cache()
        // usages that might exist elsewhere in the app for unrelated data.
        const snippetStart = match.index;
        const snippet = content.slice(snippetStart, snippetStart + 400);
        if (/auth\.(getUser|getSession)/.test(snippet)) {
          wrappers.push({ file, name: match[1] });
        }
      }
    }

    expect(wrappers).toHaveLength(1);
    expect(wrappers[0].file).toBe(
      join(REPO_ROOT, "lib", "auth", "current-user.ts"),
    );
  });

  it("the identity resolver calls auth.getUser(), never auth.getSession()", () => {
    const source = readFileSync(
      join(REPO_ROOT, "lib", "auth", "current-user.ts"),
      "utf-8",
    );

    expect(source).toMatch(/auth\.getUser\(\)/);
    expect(source).not.toMatch(/auth\.getSession\(\)/);
  });

  it("getSession() never appears in lib/auth, lib/actions, or lib/supabase as a server-side identity check", () => {
    // Scoped to the server-side auth seams this mission touches. Client
    // components legitimately call `auth.getSession()` to read a token for
    // a realtime subscription -- a different concern (no network
    // round-trip to dedupe, no server request to memoise per) that this
    // mission does not change.
    const SERVER_AUTH_DIRS = [
      join(REPO_ROOT, "lib", "auth"),
      join(REPO_ROOT, "lib", "actions"),
      join(REPO_ROOT, "lib", "supabase"),
    ];
    const files = SERVER_AUTH_DIRS.flatMap((dir) => collectFiles(dir));

    const offenders = files.filter((file) => {
      const content = readFileSync(file, "utf-8");
      return /auth\.getSession\(\)/.test(content);
    });

    expect(offenders).toEqual([]);
  });

  it("lib/actions/authz.ts imports the shared resolver instead of declaring its own", () => {
    const source = readFileSync(
      join(REPO_ROOT, "lib", "actions", "authz.ts"),
      "utf-8",
    );

    expect(source).toMatch(
      /import\s*\{\s*getCurrentUser\s*\}\s*from\s*["']@\/lib\/auth\/current-user["']/,
    );
    // The old private definition must be gone -- no second cache()-wrapped
    // function declared inline in this file.
    expect(source).not.toMatch(/cache\(async function getAuthenticatedUser/);
  });
});
