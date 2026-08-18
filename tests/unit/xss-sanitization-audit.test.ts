import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// AS-148: XSS is not possible through task titles, descriptions, or comments —
// user content is rendered as text, never as raw HTML.
//
// React escapes all text interpolated via `{expr}` JSX children by default.
// The only way to bypass that escaping is `dangerouslySetInnerHTML` (or its
// DOM-API equivalents `innerHTML =` / `insertAdjacentHTML` / `outerHTML` used
// from client code). This test asserts none of those patterns exist anywhere
// in app/ or components/, which is a structural guarantee that user-supplied
// content (task titles, descriptions, comments, project names/descriptions,
// tags, file names) can never be rendered as raw HTML.

const DANGEROUS_PATTERNS = [
  "dangerouslySetInnerHTML",
  "insertAdjacentHTML",
  ".innerHTML =",
  ".innerHTML=",
  ".outerHTML =",
  ".outerHTML=",
  "document.write(",
];

const SCAN_DIRS = ["app", "components"];
const SCAN_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

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
    } else if (SCAN_EXTENSIONS.some((ext) => fullPath.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("AS-148: no raw-HTML-injection sinks for user content", () => {
  it("app/ and components/ contain zero dangerouslySetInnerHTML / innerHTML-style sinks", () => {
    const repoRoot = join(__dirname, "..", "..");
    const files = SCAN_DIRS.flatMap((dir) => collectFiles(join(repoRoot, dir)));
    expect(files.length).toBeGreaterThan(0);

    const offenders: { file: string; pattern: string }[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const pattern of DANGEROUS_PATTERNS) {
        if (content.includes(pattern)) {
          offenders.push({ file, pattern });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
