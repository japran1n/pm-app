import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, ext: string[], results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, ext, results);
    } else if (entry.isFile() && ext.some((e) => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

function containsImport(filePath: string, pattern: string): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.includes(pattern);
  } catch {
    return false;
  }
}

describe("F011: static import isolation — architecture-details never imported by portal", () => {
  it("test_AS_no_portal_file_imports_architecture_details", () => {
    const portalDir = path.join(ROOT, "app/(portal)");
    const files = walk(portalDir, [".ts", ".tsx"]);
    const violations = files.filter((f) => containsImport(f, "architecture-details"));
    expect(violations).toEqual([]);
  });

  it("test_AS_no_client_board_imports_architecture_details", () => {
    const archDir = path.join(ROOT, "components/architecture");
    const files = walk(archDir, [".ts", ".tsx"]).filter((f) =>
      path.basename(f).startsWith("client-")
    );
    const violations = files.filter((f) => containsImport(f, "architecture-details"));
    expect(violations).toEqual([]);
  });
});
