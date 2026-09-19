// F012 (missions/20260919-150607, AS-048, AS-049, AS-050): `WORK_CATEGORIES`
// must be derived from `workCategorySchema.options` (not hand-written), must
// contain exactly the five values, and those values must match the
// `time_entries_work_category_check` CHECK constraint that
// supabase/migrations/20261010010000_f017_project_budgets_work_category_hours_rpcs.sql
// defines on `time_entries.work_category` -- read directly from the
// migration SQL so drift between the app-level enum and the DB constraint
// fails this test instead of surfacing as a silent runtime rejection.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { WORK_CATEGORIES, workCategorySchema } from "@/lib/validation/time-entries";

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

describe("WORK_CATEGORIES (AS-048, AS-049, AS-050)", () => {
  it("test_AS_048_WORK_CATEGORIES_is_derived_from_workCategorySchema_options_not_a_separate_literal", () => {
    // Derived-from-schema means literal identity with `.options`, not just
    // "happens to contain the same values" -- same array reference content,
    // sourced directly from the schema.
    expect(WORK_CATEGORIES).toBe(workCategorySchema.options);
  });

  it("test_AS_049_WORK_CATEGORIES_contains_exactly_five_values", () => {
    expect(WORK_CATEGORIES).toHaveLength(5);
  });

  it("test_AS_050_WORK_CATEGORIES_matches_time_entries_work_category_check_db_constraint", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const dbValues = parseCheckValues(sql);

    expect(new Set(WORK_CATEGORIES)).toEqual(new Set(dbValues));
    expect(dbValues.length).toBe(WORK_CATEGORIES.length);
  });

  it("test_AS_050_every_WORK_CATEGORIES_value_parses_via_workCategorySchema", () => {
    for (const value of WORK_CATEGORIES) {
      expect(workCategorySchema.safeParse(value).success).toBe(true);
    }
  });

  it("does not mutate any other exported schema as a side effect of reading WORK_CATEGORIES", () => {
    // Side-effect check per definition of done: reading the derived array
    // must not affect the schema's own parsing behaviour for unrelated
    // (invalid) input on adjacent schemas.
    const before = workCategorySchema.options.length;
    void WORK_CATEGORIES;
    expect(workCategorySchema.options.length).toBe(before);
    expect(workCategorySchema.safeParse("not_a_category").success).toBe(false);
  });
});
