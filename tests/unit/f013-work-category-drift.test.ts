import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { WORK_CATEGORIES } from "@/lib/validation/time-entries";

// F013 / AS-054: WORK_CATEGORIES must stay the single source of truth for
// work category values. This test parses the DB CHECK constraint directly
// out of the migration SQL and asserts it matches WORK_CATEGORIES exactly,
// so any future drift between the app-level enum and the DB constraint
// fails CI instead of surfacing as a silent runtime rejection. Mirrors the
// AS-014 pattern in tests/unit/f053-section-kind-drift.test.ts.
const MIGRATION_PATH = path.join(
  process.cwd(),
  "supabase/migrations/20261010010000_f017_project_budgets_work_category_hours_rpcs.sql",
);

function parseCheckValues(sql: string): string[] {
  const match = sql.match(
    /time_entries_work_category_check\s+check\s*\(\s*work_category\s+in\s*\(([^)]+)\)/i,
  );
  if (!match) {
    throw new Error(
      "Could not find time_entries_work_category_check constraint in migration SQL",
    );
  }
  return match[1]
    .split(",")
    .map((v) => v.trim().replace(/^'|'$/g, ""));
}

describe("AS-054: work_category single source of truth", () => {
  it("matches the time_entries_work_category_check DB constraint exactly", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const dbValues = parseCheckValues(sql);

    expect(new Set(WORK_CATEGORIES)).toEqual(new Set(dbValues));
    expect(dbValues.length).toBe(WORK_CATEGORIES.length);
  });

  it("does not silently pass if a value is added to only one side", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const dbValues = parseCheckValues(sql);
    const driftedAppValues = [...WORK_CATEGORIES, "invented_category"];

    expect(new Set(driftedAppValues)).not.toEqual(new Set(dbValues));
  });
});
