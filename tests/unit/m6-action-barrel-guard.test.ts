import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const BARREL_PATH = path.join(ROOT, "lib/actions/architecture.ts");
const LEAF_DIR = path.join(ROOT, "lib/actions/architecture");

const EXCLUDED_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build"]);

function isTestFile(filePath: string): boolean {
  return /\.(test|spec)\.(ts|tsx)$/.test(filePath);
}

function collectFiles(dir: string, out: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      collectFiles(path.join(dir, entry.name), out);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function stripComments(src: string): string {
  // Strip block comments /* ... */
  src = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Strip line comments // ...
  src = src.replace(/\/\/[^\n]*/g, " ");
  return src;
}

function stripCommentsAndStrings(src: string): string {
  src = stripComments(src);
  // Strip string literals (simple approximation — single, double, template)
  src = src.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  src = src.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  src = src.replace(/`(?:[^`\\]|\\.)*`/g, "``");
  return src;
}

function parseBarrelExports(source: string): string[] {
  if (/export\s*\*/.test(stripCommentsAndStrings(source))) {
    expect.fail("barrel uses export * — guard cannot enumerate actions");
  }

  const names: string[] = [];
  // Match `export { a, b, c } from "..."` blocks (value exports, not `export type { ... }`)
  const exportBlockRegex = /export\s*\{([^}]*)\}\s*from\s*["'][^"']+["'];?/g;
  let match: RegExpExecArray | null;
  while ((match = exportBlockRegex.exec(source)) !== null) {
    // Skip if this is actually preceded by "export type" (check the block start)
    const fullMatchStart = match.index;
    const precedingText = source.slice(Math.max(0, fullMatchStart - 6), fullMatchStart);
    if (/type\s*$/.test(precedingText)) continue;

    const inner = match[1];
    const identifiers = inner
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        // handle "foo as bar" -> take the exported alias "bar"
        const asMatch = s.match(/\bas\s+(\w+)$/);
        return asMatch ? asMatch[1] : s;
      })
      .filter((s) => /^\w+$/.test(s));
    names.push(...identifiers);
  }
  return names;
}

// EXPECTED_ACTION_COUNT is hard-coded from a manual count of value exports in
// lib/actions/architecture.ts at the time this guard was written (F107,
// AS-130). If the barrel legitimately grows or shrinks, update this number
// deliberately — do not let it drift silently.
const EXPECTED_ACTION_COUNT = 23;

/**
 * Returns true if `actionName` is referenced as a real import (from the
 * architecture actions barrel or its leaf modules) or as a function call
 * `actionName(...)` in the given (comment/string-stripped) source.
 */
function hasRealReference(
  commentOnlyStrippedContent: string,
  callSiteContent: string,
  actionName: string
): boolean {
  // 1. Function call site: actionName( — checked against the content with
  // both comments and string literals stripped, so a call-shaped mention
  // inside a string or comment doesn't count.
  const callRegex = new RegExp(`\\b${actionName}\\s*\\(`);
  if (callRegex.test(callSiteContent)) return true;

  // 2. Import from the architecture actions barrel (or a leaf module under
  // lib/actions/architecture/), where the import specifier list contains
  // actionName as a named (possibly aliased) import. Checked against
  // comment-only-stripped content so the quoted module specifier survives.
  const importBlockRegex = /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?/g;
  let match: RegExpExecArray | null;
  while ((match = importBlockRegex.exec(commentOnlyStrippedContent)) !== null) {
    const specifier = match[2];
    if (!/lib\/actions\/architecture/.test(specifier)) continue;
    const inner = match[1];
    const names = inner
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+as\s+/)[0].trim());
    if (names.includes(actionName)) return true;
  }

  return false;
}

describe("AS-130: architecture action barrel guard", () => {
  const barrelSource = fs.readFileSync(BARREL_PATH, "utf8");
  const actionNames = parseBarrelExports(barrelSource);

  it("parses the expected number of exported actions from the barrel", () => {
    expect(actionNames.length).toBe(EXPECTED_ACTION_COUNT);
  });

  it("every exported architecture action has at least one real import/call reference outside the barrel, leaf modules, and tests", () => {
    const allFiles = collectFiles(ROOT);

    const candidateFiles = allFiles.filter((filePath) => {
      const resolved = path.resolve(filePath);
      if (resolved === path.resolve(BARREL_PATH)) return false;
      if (resolved.startsWith(path.resolve(LEAF_DIR) + path.sep)) return false;
      if (isTestFile(resolved)) return false;
      return true;
    });

    const fileContents = candidateFiles.map((filePath) => {
      const raw = fs.readFileSync(filePath, "utf8");
      return {
        filePath,
        commentOnlyStripped: stripComments(raw),
        callSiteContent: stripCommentsAndStrings(raw),
      };
    });

    const unusedActions: string[] = [];

    for (const actionName of actionNames) {
      const isUsed = fileContents.some(({ commentOnlyStripped, callSiteContent }) =>
        hasRealReference(commentOnlyStripped, callSiteContent, actionName)
      );
      if (!isUsed) {
        unusedActions.push(actionName);
      }
    }

    expect(
      unusedActions,
      `The following architecture action(s) exported from lib/actions/architecture.ts have no real import/call reference outside the barrel, leaf modules (lib/actions/architecture/), and test files: ${unusedActions.join(", ")}`
    ).toEqual([]);
  });
});
