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

function parseBarrelExports(source: string): string[] {
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

describe("AS-130: architecture action barrel guard", () => {
  const barrelSource = fs.readFileSync(BARREL_PATH, "utf8");
  const actionNames = parseBarrelExports(barrelSource);

  it("parses at least one exported action from the barrel", () => {
    expect(actionNames.length).toBeGreaterThan(0);
  });

  it("every exported architecture action has at least one reference outside the barrel, leaf modules, and tests", () => {
    const allFiles = collectFiles(ROOT);

    const candidateFiles = allFiles.filter((filePath) => {
      const resolved = path.resolve(filePath);
      if (resolved === path.resolve(BARREL_PATH)) return false;
      if (resolved.startsWith(path.resolve(LEAF_DIR) + path.sep)) return false;
      if (isTestFile(resolved)) return false;
      return true;
    });

    const fileContents = candidateFiles.map((filePath) => ({
      filePath,
      content: fs.readFileSync(filePath, "utf8"),
    }));

    const unusedActions: string[] = [];

    for (const actionName of actionNames) {
      const wordBoundaryRegex = new RegExp(`\\b${actionName}\\b`);
      const isUsed = fileContents.some(({ content }) => wordBoundaryRegex.test(content));
      if (!isUsed) {
        unusedActions.push(actionName);
      }
    }

    expect(
      unusedActions,
      `The following architecture action(s) exported from lib/actions/architecture.ts have no reference outside the barrel, leaf modules (lib/actions/architecture/), and test files: ${unusedActions.join(", ")}`
    ).toEqual([]);
  });
});
