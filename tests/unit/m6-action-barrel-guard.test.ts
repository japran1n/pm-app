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

const SCAN_DIRS = ["app", "components", "lib"];

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

// Only scan app/, components/, lib/ — test helpers, scripts, missions docs,
// and the extension package must never count as a "real reference".
function collectScannableFiles(root: string): string[] {
  const out: string[] = [];
  for (const dirName of SCAN_DIRS) {
    const dirPath = path.join(root, dirName);
    if (fs.existsSync(dirPath)) {
      collectFiles(dirPath, out);
    }
  }
  return out;
}

/**
 * Single left-to-right scan that tracks comment/string context together,
 * rather than stripping comments and strings with independent regexes.
 * Two independent-regex approaches are both unsound on real source:
 *
 * - Stripping `//...` comments before scanning strings mis-parses a URL
 *   inside a string literal (e.g. `useState("https://example.com")`): the
 *   `//` is treated as a comment start, truncating the string and eating its
 *   closing quote, which corrupts all subsequent quote pairing in the file.
 * - Stripping each quote type independently mis-parses a contraction like
 *   "don't" inside a double-quoted string: the lone apostrophe is treated as
 *   opening a single-quoted string that only closes at some unrelated
 *   apostrophe far later in the file.
 *
 * `keepStrings` controls whether string literal contents (including the
 * quotes) are preserved in the output — needed when the caller still wants
 * to read a quoted module specifier (e.g. barrel export parsing) — or
 * dropped entirely, which is what real call-site/import detection wants.
 */
function scanSource(src: string, keepStrings: boolean): string {
  let out = "";
  let quote: "'" | '"' | "`" | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      if (keepStrings) out += ch;
      if (ch === "\\") {
        if (keepStrings) out += next ?? "";
        i++; // skip escaped char
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    // Not in a comment or string: comment/string starts take priority over
    // treating '/' as division.
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      if (keepStrings) out += ch;
      continue;
    }

    out += ch;
  }
  return out;
}

function stripComments(src: string): string {
  return scanSource(src, true);
}

function stripCommentsAndStrings(src: string): string {
  return scanSource(src, false);
}

function parseBarrelExports(source: string): string[] {
  const stripped = stripCommentsAndStrings(source);

  for (const line of stripped.split("\n")) {
    if (/export\s*\*/.test(line) || /export\s+default/.test(line)) {
      expect.fail(
        `barrel uses export* or export default — guard cannot enumerate actions: ${line.trim()}`,
      );
    }
    if (/export\s*\{[^}]+\}(?!\s*from)/.test(line)) {
      expect.fail(
        `barrel has an export without a "from" clause — guard cannot enumerate actions: ${line.trim()}`,
      );
    }
  }

  const names: string[] = [];
  // Match `export { a, b, c } from "..."` blocks (value exports, not `export type { ... }`).
  // Comments are stripped (so a commented-out export doesn't count) but string
  // literals (the module specifier) are preserved so the "from" clause still matches.
  const commentsOnly = stripComments(source);
  const exportBlockRegex = /export\s*\{([^}]*)\}\s*from\s*["'][^"']+["'];?/g;
  let match: RegExpExecArray | null;
  while ((match = exportBlockRegex.exec(commentsOnly)) !== null) {
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
