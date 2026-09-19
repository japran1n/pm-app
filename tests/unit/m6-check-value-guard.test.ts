import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { pageKindEnum, sectionKindEnum } from "@/lib/validation/architecture";

// F037/F108 (AS-126..AS-129): guards against drift between the DB CHECK
// constraints on public.tasks.page_kind / section_kind and the Zod enums
// (pageKindEnum, sectionKindEnum) in lib/validation/architecture.ts that
// mirror them. If a future migration widens/narrows a CHECK constraint
// without updating the corresponding Zod enum (or vice versa), this test
// fails loudly instead of letting the drift surface as a runtime insert
// error or a silently-too-permissive client-side validator.

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

/**
 * Finds the current (last-applied) definition of a named CHECK constraint by
 * scanning all migration files in chronological order, tracking both
 * `drop constraint <name>` and `constraint <name> check (...)` occurrences.
 *
 * Uses parenthesis balancing to find the full CHECK expression body (instead
 * of a lazy regex that can cross statement/semicolon boundaries), and
 * understands both Postgres value-list renderings:
 *   - `col in ('a', 'b', 'c')`
 *   - `col = any (array['a', 'b', 'c'])`
 *
 * Throws if the constraint is unknown, was dropped without a later re-add,
 * or if its CHECK expression doesn't match either known shape (rather than
 * silently falling back to stale/incorrect data).
 */
function findLastCheckConstraintValues(
  constraintName: string,
  migrationsDir: string = MIGRATIONS_DIR,
): string[] {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // filenames are timestamp-prefixed, so lexical sort == chronological

  let lastDefinition: string[] | null = null;
  let lastWasDrop = false;

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");

    const dropRe = new RegExp(
      `drop\\s+constraint\\s+(?:if\\s+exists\\s+)?${constraintName}\\b`,
      "gi",
    );
    if (dropRe.test(sql)) {
      lastWasDrop = true;
      lastDefinition = null;
    }

    const defRe = new RegExp(`constraint\\s+${constraintName}\\s+check\\s*\\(`, "gi");
    let match: RegExpExecArray | null;
    while ((match = defRe.exec(sql)) !== null) {
      lastWasDrop = false;

      // Balance parens starting right after the opening "(" already consumed
      // by the regex, to find the exact end of the CHECK expression body —
      // this prevents the search from crossing into unrelated SQL that
      // follows (e.g. a semicolon-terminated next statement).
      let depth = 1;
      let i = match.index + match[0].length;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "(") depth++;
        else if (sql[i] === ")") depth--;
        i++;
      }
      const checkExpr = sql.slice(match.index + match[0].length, i - 1);

      const inMatch = checkExpr.match(/\bin\s*\(\s*([\s\S]+?)\s*\)/i);
      if (inMatch) {
        lastDefinition = extractStringLiterals(inMatch[1]);
        continue;
      }

      const anyMatch = checkExpr.match(
        /=\s*any\s*\(\s*array\s*\[\s*([\s\S]+?)\s*\]\s*\)/i,
      );
      if (anyMatch) {
        lastDefinition = extractStringLiterals(anyMatch[1]);
        continue;
      }

      throw new Error(
        `Cannot parse CHECK expression for constraint "${constraintName}" in ${file}: ${checkExpr.slice(0, 200)}`,
      );
    }
  }

  if (lastWasDrop || lastDefinition === null) {
    throw new Error(
      `Constraint "${constraintName}" was dropped without a later re-add, or was never defined, in ${migrationsDir}`,
    );
  }

  return lastDefinition;
}

/** Extracts single-quoted SQL string literals from a fragment of SQL. */
function extractStringLiterals(fragment: string): string[] {
  const values: string[] = [];
  const literalRegex = /'((?:[^']|'')*)'/g;
  let m: RegExpExecArray | null;
  while ((m = literalRegex.exec(fragment)) !== null) {
    values.push(m[1].replace(/''/g, "'"));
  }
  return values;
}

const FIXTURES_DIR = path.join(process.cwd(), "tests", "fixtures", "m6-check-guard");

/**
 * Builds a temporary migrations-like directory containing only the given
 * fixture files (by filename, in order), so `findLastCheckConstraintValues`
 * can be exercised against a controlled, minimal SQL corpus instead of the
 * real (large, evolving) migrations directory. This is what actually proves
 * the parser reads and interprets SQL, rather than returning a hardcoded map.
 */
function fixtureDir(...filenames: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m6-check-fixture-"));
  for (const filename of filenames) {
    fs.copyFileSync(
      path.join(FIXTURES_DIR, filename),
      path.join(dir, filename),
    );
  }
  return dir;
}

describe("m6 CHECK constraint vs Zod enum drift guard", () => {
  it("AS-127: parser reads SQL files — unknown constraint throws even with real migrations", () => {
    expect(() => findLastCheckConstraintValues("tasks_nonexistent_xyz_check")).toThrow(/nonexistent_xyz/i);
  });

  it("AS-128: pageKindEnum matches tasks_page_kind_check", () => {
    const dbValues = findLastCheckConstraintValues("tasks_page_kind_check");
    const zodValues = pageKindEnum.options;

    const onlyInDb = dbValues.filter((v) => !zodValues.includes(v as never));
    const onlyInZod = zodValues.filter((v) => !dbValues.includes(v));

    expect(
      new Set(zodValues),
      `Drift between tasks_page_kind_check and pageKindEnum. onlyInDb=${JSON.stringify(onlyInDb)} onlyInZod=${JSON.stringify(onlyInZod)}`,
    ).toEqual(new Set(dbValues));
    expect(dbValues.length).toBe(zodValues.length);
  });

  it("AS-129: sectionKindEnum matches tasks_section_kind_check", () => {
    const dbValues = findLastCheckConstraintValues("tasks_section_kind_check");
    const zodValues = sectionKindEnum.options;

    const onlyInDb = dbValues.filter((v) => !zodValues.includes(v as never));
    const onlyInZod = zodValues.filter((v) => !dbValues.includes(v));

    expect(
      new Set(zodValues),
      `Drift between tasks_section_kind_check and sectionKindEnum. onlyInDb=${JSON.stringify(onlyInDb)} onlyInZod=${JSON.stringify(onlyInZod)}`,
    ).toEqual(new Set(dbValues));
    expect(dbValues.length).toBe(zodValues.length);
  });
});

describe("parser fixtures", () => {
  it("AS-127: parses IN(...) form from a single migration file", () => {
    const dir = fixtureDir("01_initial.sql");
    expect(findLastCheckConstraintValues("tasks_test_kind_check", dir)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("AS-127: picks the latest migration's IN(...) redefinition (widen)", () => {
    const dir = fixtureDir("01_initial.sql", "02_widen_in.sql");
    expect(findLastCheckConstraintValues("tasks_test_kind_check", dir)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("AS-127: parses = ANY (ARRAY[...]) form, picks latest migration", () => {
    const dir = fixtureDir("01_initial.sql", "03_any_form.sql");
    expect(findLastCheckConstraintValues("tasks_test_kind_check", dir)).toEqual([
      "alpha",
      "beta",
      "gamma",
      "delta",
    ]);
  });

  it("AS-127: throws when the constraint was dropped without a later re-add", () => {
    const dir = fixtureDir("01_initial.sql", "04_drop.sql");
    expect(() => findLastCheckConstraintValues("tasks_test_kind_check", dir)).toThrow();
  });

  it("AS-127: throws on unknown constraint name against the real migrations dir", () => {
    expect(() => findLastCheckConstraintValues("tasks_nonexistent_xyz_check")).toThrow();
  });
});
