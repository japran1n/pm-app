import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// F036 (missions/20260919-150607, AS-121): guards against `estimated_by`
// or `updated_by` being re-added to any SELECT issued against
// task_discipline_estimates / architecture_node_meta. This is a static
// source check (not a DB round trip) so it fails immediately -- no seed
// data or Supabase connection required -- the moment either column name
// reappears inside a `.select(...)` call anywhere in this module.
const source = readFileSync(
  path.join(__dirname, "architecture-details.ts"),
  "utf-8",
);

function selectCalls(src: string): string[] {
  const matches = [...src.matchAll(/\.select\(\s*"([^"]*)"\s*\)/g)];
  return matches.map((m) => m[1]);
}

describe("AS-121: discipline_estimates queries never load estimated_by/updated_by", () => {
  const calls = selectCalls(source);

  it("finds at least one .select(...) call to guard", () => {
    expect(calls.length).toBeGreaterThan(0);
  });

  it("no .select(...) call in architecture-details.ts includes estimated_by", () => {
    for (const columns of calls) {
      expect(columns.split(",").map((c) => c.trim())).not.toContain(
        "estimated_by",
      );
    }
  });

  it("no .select(...) call in architecture-details.ts includes updated_by", () => {
    for (const columns of calls) {
      expect(columns.split(",").map((c) => c.trim())).not.toContain(
        "updated_by",
      );
    }
  });

  it("the DisciplineEstimate/NodeMeta types no longer declare these fields", () => {
    const typesSource = readFileSync(
      path.join(__dirname, "..", "architecture", "types.ts"),
      "utf-8",
    );
    expect(typesSource).not.toMatch(/estimatedBy\s*:/);
    expect(typesSource).not.toMatch(/updatedBy\s*:/);
  });
});
