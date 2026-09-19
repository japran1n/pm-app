import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { SECTION_KINDS } from "@/lib/validation/architecture";

// F053 / AS-014: SECTION_KINDS must be the single source of truth for
// section kinds. This test parses the DB CHECK constraint directly out of
// the migration SQL and asserts it matches SECTION_KINDS exactly, so any
// future drift between the app-level enum and the DB constraint fails CI
// instead of surfacing as a silent runtime rejection.
const MIGRATION_PATH = path.join(
  process.cwd(),
  "supabase/migrations/20261124010000_architecture_cms_template_and_section_kind.sql",
);

function parseCheckValues(sql: string): string[] {
  const match = sql.match(
    /tasks_section_kind_check\s+check\s*\(\s*section_kind\s+in\s*\(([^)]+)\)/i,
  );
  if (!match) {
    throw new Error("Could not find tasks_section_kind_check constraint in migration SQL");
  }
  return match[1]
    .split(",")
    .map((v) => v.trim().replace(/^'|'$/g, ""));
}

describe("AS-014: section_kind single source of truth", () => {
  it("matches the tasks_section_kind_check DB constraint exactly", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const dbValues = parseCheckValues(sql);

    expect(new Set(SECTION_KINDS)).toEqual(new Set(dbValues));
    expect(dbValues.length).toBe(SECTION_KINDS.length);
  });
});
