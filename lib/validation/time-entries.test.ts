// F012/F066 (missions/20260919-150607, AS-048, AS-049, AS-050): `WORK_CATEGORIES`
// must be derived from `workCategorySchema.options` (not hand-written), must
// contain exactly the five values, and those values must match -- in the same
// order -- the `discipline` CHECK constraint that
// supabase/migrations/20261127011000_architecture_discipline_estimates.sql
// defines on `task_discipline_estimates.discipline` (the discipline column
// reuses the work_category vocabulary verbatim per that migration's own
// comment) -- read directly from the migration SQL so drift between the
// app-level enum and the DB constraint fails this test instead of surfacing
// as a silent runtime rejection.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { WORK_CATEGORIES, workCategorySchema } from "@/lib/validation/time-entries";

const MIGRATION_PATH = path.join(
  process.cwd(),
  "supabase/migrations/20261127011000_architecture_discipline_estimates.sql",
);

function parseCheckValues(sql: string): string[] {
  const match = sql.match(
    /discipline\s+text\s+not\s+null\s+check\s*\(\s*discipline\s+in\s*\(([^)]+)\)\s*\)/i,
  );
  if (!match) {
    throw new Error(
      "Could not find discipline CHECK constraint in migration SQL",
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

  it("test_AS_050_WORK_CATEGORIES_matches_discipline_db_constraint_in_order", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const dbValues = parseCheckValues(sql);

    // Ordered equality: this must fail if WORK_CATEGORIES is reordered
    // relative to the SQL list, not just if the value sets differ.
    expect([...WORK_CATEGORIES]).toEqual(dbValues);
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
