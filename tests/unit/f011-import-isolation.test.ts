import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function grepImports(pattern: string, dirs: string[]): string[] {
  try {
    const quotedDirs = dirs.map((d) => `'${d}'`).join(" ");
    const result = execSync(
      `grep -r --include="*.ts" --include="*.tsx" -l "${pattern}" ${quotedDirs}`,
      { cwd: ROOT, encoding: "utf-8" }
    );
    return result.trim().split("\n").filter(Boolean);
  } catch {
    // grep exits 1 when no matches — that's the success case
    return [];
  }
}

describe("F011: static import isolation — architecture-details never imported by portal", () => {
  it("test_AS_no_portal_file_imports_architecture_details", () => {
    const hits = grepImports("architecture-details", [
      "app/(portal)",
      "components/architecture/client-",
    ]);
    expect(hits).toEqual([]);
  });

  it("test_AS_no_client_board_imports_architecture_details", () => {
    const hits = grepImports("architecture-details", ["components/architecture"]);
    // Only allowed in non-client files — filter out any file that IS architecture-details itself
    const violations = hits.filter(
      (f) => !f.includes("architecture-details") && f.match(/client-/)
    );
    expect(violations).toEqual([]);
  });
});
