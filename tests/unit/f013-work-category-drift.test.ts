import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { WORK_CATEGORIES } from "@/lib/validation/time-entries";

// F013 / AS-054 (missions/20260919-150607): WORK_CATEGORIES must stay the
// single source of truth for work category values, and the drift guard
// must point at the constraint the contract actually names: the
// `discipline` CHECK on `task_discipline_estimates`, defined in
// 20261127011000_architecture_discipline_estimates.sql, which that
// migration's own comment states reuses the work_category vocabulary
// verbatim and in the same order as `time_entries_work_category_check`
// (20261010010000). AS-050 (lib/validation/time-entries.test.ts) covers
// the same equality from the other named constraint; both must agree.
//
// The guard globs every migration file (not a single hard-pinned path)
// and takes the LAST definition of the named constraint, sorted by
// filename, so a later `drop constraint ... add constraint` migration
// can never leave this test silently reading a stale file. Comparison is
// an ordered array match (toEqual), not a Set, because AS-050/AS-054
// both require the same canonical order, not just the same membership.
const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

function parseDisciplineCheckValues(sql: string): string[][] {
  const matches = sql.matchAll(
    /discipline\s+text\s+not\s+null\s+check\s*\(\s*discipline\s+in\s*\(([^)]+)\)\)/gi,
  );
  const definitions: string[][] = [];
  for (const match of matches) {
    definitions.push(
      match[1].split(",").map((v) => v.trim().replace(/^'|'$/g, "")),
    );
  }
  return definitions;
}

function findAllDisciplineCheckDefinitions(dir: string = MIGRATIONS_DIR): string[][] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const definitions: string[][] = [];
  for (const file of files) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    definitions.push(...parseDisciplineCheckValues(sql));
  }
  return definitions;
}

function getCanonicalDisciplineCheckValues(): string[] {
  const definitions = findAllDisciplineCheckDefinitions();
  if (definitions.length === 0) {
    throw new Error(
      "Could not find the `discipline ... check (discipline in (...))` constraint " +
        "in any supabase/migrations/*.sql file",
    );
  }
  // Filenames were processed in sorted order, so the last match found is
  // the most recent definition -- the one that actually governs the DB
  // today, even if an earlier migration also defined it.
  return definitions[definitions.length - 1];
}

describe("AS-054: work_category single source of truth", () => {
  it("matches the discipline CHECK constraint (task_discipline_estimates) exactly and in order", () => {
    const dbValues = getCanonicalDisciplineCheckValues();

    expect([...WORK_CATEGORIES]).toEqual(dbValues);
  });

  it("does not match unrelated SQL, so it throws loudly instead of passing silently", () => {
    const unrelatedSql = `
      create table foo (id uuid, work_category text not null check (work_category in ('design')));
    `;
    expect(parseDisciplineCheckValues(unrelatedSql)).toEqual([]);
  });

  it("picks the LAST definition when multiple migrations define the discipline constraint", () => {
    // Simulates the drop-constraint/add-constraint convention this repo
    // uses: an earlier migration's definition must not win over a later
    // one that redefines the same constraint with different values.
    const earlier = `discipline text not null check (discipline in ('design','qa'))`;
    const later = `discipline text not null check (discipline in ('design','development','content_seo','pm','qa'))`;
    const definitions = [
      ...parseDisciplineCheckValues(earlier),
      ...parseDisciplineCheckValues(later),
    ];
    expect(definitions[definitions.length - 1]).toEqual([
      "design",
      "development",
      "content_seo",
      "pm",
      "qa",
    ]);
  });

  it("fails if a value is added to WORK_CATEGORIES that the DB constraint does not have", () => {
    const dbValues = getCanonicalDisciplineCheckValues();
    const driftedAppValues = [...WORK_CATEGORIES, "invented_category"];

    expect(driftedAppValues).not.toEqual(dbValues);
  });

  it("fails if a value is removed from WORK_CATEGORIES that the DB constraint still has", () => {
    const dbValues = getCanonicalDisciplineCheckValues();
    const driftedAppValues = [...WORK_CATEGORIES].slice(0, -1);

    expect(driftedAppValues).not.toEqual(dbValues);
  });

  it("fails if WORK_CATEGORIES is reordered relative to the DB constraint", () => {
    const dbValues = getCanonicalDisciplineCheckValues();
    // Only meaningful when there's more than one value to reorder.
    expect(dbValues.length).toBeGreaterThan(1);
    const reordered = [...dbValues].reverse();

    expect(reordered).not.toEqual(dbValues);
  });
});
