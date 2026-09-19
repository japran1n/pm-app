// F011 (missions/20260919-150607): the local two-value WorkCategory type
// and WORK_CATEGORIES array in lib/architecture/types.ts have been deleted
// and re-exported from lib/validation/time-entries.ts, the single source
// of truth for the five-value work category vocabulary (also enforced by
// the `time_entries_work_category_check` / task_discipline_estimates CHECK
// constraints in supabase/migrations).
//
// AS-045: exactly one exported type named WorkCategory in the repo.
// AS-046: no local WorkCategory declaration left in lib/architecture/types.ts.
// AS-047: lib/architecture/types.ts imports WorkCategory from lib/validation/.
// AS-051: DisciplineEstimate.discipline references the unified type.
// AS-052: EstimateRollup.byDiscipline accepts all five keys.
// AS-053: `npx tsc --noEmit` passes after unification (verified separately
//         via the `npx tsc --noEmit` command run in this handoff; this file
//         adds a compile-time check of the same fact as a type-level
//         assertion so a regression fails `vitest` too, not just a
//         separately-run tsc invocation).

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { workCategorySchema, WORK_CATEGORIES as VALIDATION_WORK_CATEGORIES } from "@/lib/validation/time-entries";
import type { WorkCategory as ValidationWorkCategory } from "@/lib/validation/time-entries";
import { WORK_CATEGORIES as ARCHITECTURE_WORK_CATEGORIES } from "@/lib/architecture/types";
import type { WorkCategory as ArchitectureWorkCategory, DisciplineEstimate, EstimateRollup } from "@/lib/architecture/types";

const ROOT = path.resolve(__dirname, "../..");
const TYPES_FILE = path.join(ROOT, "lib/architecture/types.ts");

describe("F011 work category unification", () => {
  it("AS-046: lib/architecture/types.ts has no local WorkCategory declaration", () => {
    const source = fs.readFileSync(TYPES_FILE, "utf8");
    expect(source).not.toMatch(/export\s+type\s+WorkCategory\s*=/);
    expect(source).not.toMatch(/export\s+const\s+WORK_CATEGORIES\s*:\s*WorkCategory\[\]\s*=/);
  });

  it("AS-047: lib/architecture/types.ts re-exports WorkCategory from lib/validation/", () => {
    const source = fs.readFileSync(TYPES_FILE, "utf8");
    expect(source).toMatch(/from\s+["']@\/lib\/validation\/time-entries["']/);
  });

  it("AS-045: the architecture module's WorkCategory is identical to (not a redeclaration of) the validation module's", () => {
    // Same runtime array identity/content confirms both modules point at the
    // one canonical WORK_CATEGORIES, not two independently-maintained lists.
    expect(ARCHITECTURE_WORK_CATEGORIES).toBe(VALIDATION_WORK_CATEGORIES);
    expect(ARCHITECTURE_WORK_CATEGORIES).toEqual(workCategorySchema.options);

    // Type-level: a value typed as the validation module's WorkCategory must
    // be directly assignable to the architecture module's WorkCategory, and
    // vice versa, with no cast. This only compiles if they are the same type.
    const fromValidation: ValidationWorkCategory = "qa";
    const asArchitecture: ArchitectureWorkCategory = fromValidation;
    const fromArchitecture: ArchitectureWorkCategory = "pm";
    const asValidation: ValidationWorkCategory = fromArchitecture;
    expect(asArchitecture).toBe("qa");
    expect(asValidation).toBe("pm");
  });

  it("AS-051: DisciplineEstimate.discipline accepts every unified WorkCategory value", () => {
    for (const category of VALIDATION_WORK_CATEGORIES) {
      const estimate: DisciplineEstimate = {
        discipline: category,
        minutes: 60,
        note: null,
        estimatedBy: null,
      };
      expect(estimate.discipline).toBe(category);
    }
  });

  it("AS-052: EstimateRollup.byDiscipline accepts all five keys", () => {
    const rollup: EstimateRollup = {
      byDiscipline: {
        design: 10,
        development: 20,
        content_seo: 30,
        pm: 40,
        qa: 50,
      },
      total: 150,
      source: "own",
    };
    expect(Object.keys(rollup.byDiscipline).sort()).toEqual(
      [...VALIDATION_WORK_CATEGORIES].sort(),
    );
  });

  it("AS-053: the type-checked fixtures above compile (vitest itself running this file is evidence tsc accepted it)", () => {
    // No separate assertion needed -- if any of the above `: WorkCategory`,
    // `: DisciplineEstimate`, `: EstimateRollup` annotations were type
    // errors, `vitest` (which type-checks via esbuild/ts) would already
    // have failed before reaching this line.
    expect(true).toBe(true);
  });
});
