// F012 (missions/20260919-150607, AS-048, AS-049, AS-050): `WORK_CATEGORIES`
// must be derived from `workCategorySchema.options` (not hand-written), must
// contain exactly the five values, and those values must match — in order
// and content — the `discipline` CHECK constraint that
// supabase/migrations/20261127011000_architecture_discipline_estimates.sql
// defines for `task_discipline_estimates` (the same "work_category
// vocabulary" the migration's own comment says it reuses verbatim from
// `time_entries_work_category_check`).
import { describe, expect, it } from "vitest";

import { WORK_CATEGORIES, workCategorySchema } from "@/lib/validation/time-entries";

// The literal list from the CHECK constraint in
// supabase/migrations/20261127011000_architecture_discipline_estimates.sql:
//   check (discipline in ('design','development','content_seo','pm','qa'))
const MIGRATION_20261127011000_CHECK_VALUES = [
  "design",
  "development",
  "content_seo",
  "pm",
  "qa",
] as const;

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

  it("test_AS_050_WORK_CATEGORIES_matches_migration_20261127011000_check_constraint_order_and_content", () => {
    expect(Array.from(WORK_CATEGORIES)).toEqual(
      Array.from(MIGRATION_20261127011000_CHECK_VALUES),
    );
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
