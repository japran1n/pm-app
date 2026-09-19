import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { pageKindEnum, sectionKindEnum } from "@/lib/validation/architecture";

// F037 (AS-126..AS-129): guards against drift between the DB CHECK
// constraints on public.tasks.page_kind / section_kind and the Zod enums
// (pageKindEnum, sectionKindEnum) in lib/validation/architecture.ts that
// mirror them. If a future migration widens/narrows a CHECK constraint
// without updating the corresponding Zod enum (or vice versa), this test
// fails loudly instead of letting the drift surface as a runtime insert
// error or a silently-too-permissive client-side validator.

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

/**
 * Extracts the string values inside an `... in ('a', 'b', 'c')` list for a
 * given CHECK constraint name, from the LAST migration file (in filename /
 * chronological order) that defines that constraint. Handles multi-line
 * IN(...) lists and both single- and double-quoted SQL string literals
 * (Postgres uses single quotes, but we tolerate '' escaped quotes too).
 */
function findLastCheckConstraintValues(constraintName: string): string[] {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // filenames are timestamp-prefixed, so lexical sort == chronological

  let lastMatchValues: string[] | null = null;
  let lastMatchFile: string | null = null;

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

    // Find every occurrence of the constraint name, then look for the
    // nearest `in (...)` list following it (allowing the column name and
    // whitespace/newlines in between, e.g.:
    //   alter table public.tasks add constraint tasks_page_kind_check check (
    //     page_kind is null or page_kind in ('static', 'cms', ...)
    //   );
    // Anchor specifically to the "add constraint <name> check (...)" clause
    // that defines the constraint, not any later mention of the constraint
    // name (e.g. in a `comment on constraint` statement), which would let
    // the search wander into an unrelated `in (...)` list further down the
    // file.
    const constraintRegex = new RegExp(
      `add\\s+constraint\\s+${constraintName}\\b[\\s\\S]*?\\bin\\s*\\(([\\s\\S]*?)\\)`,
      "g",
    );

    let match: RegExpExecArray | null;
    while ((match = constraintRegex.exec(sql)) !== null) {
      const listBody = match[1];
      const values = extractStringLiterals(listBody);
      if (values.length > 0) {
        lastMatchValues = values;
        lastMatchFile = file;
      }
    }
  }

  if (!lastMatchValues) {
    throw new Error(
      `Could not find any migration defining CHECK constraint "${constraintName}" in ${MIGRATIONS_DIR}`,
    );
  }

  // Sanity note for debugging test failures (not asserted on, just context
  // if someone reads a failure message with --reporter=verbose).
  void lastMatchFile;

  return lastMatchValues;
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

describe("m6 CHECK constraint vs Zod enum drift guard", () => {
  it("AS-126: tasks_page_kind_check DB values match pageKindEnum exactly", () => {
    const dbValues = findLastCheckConstraintValues("tasks_page_kind_check");
    const zodValues = pageKindEnum.options;

    expect(new Set(zodValues)).toEqual(new Set(dbValues));
  });

  it("AS-127: pageKindEnum has no extra values beyond the DB CHECK constraint", () => {
    const dbValues = new Set(findLastCheckConstraintValues("tasks_page_kind_check"));
    for (const value of pageKindEnum.options) {
      expect(dbValues.has(value)).toBe(true);
    }
  });

  it("AS-128: tasks_section_kind_check DB values match sectionKindEnum exactly", () => {
    const dbValues = findLastCheckConstraintValues("tasks_section_kind_check");
    const zodValues = sectionKindEnum.options;

    expect(new Set(zodValues)).toEqual(new Set(dbValues));
  });

  it("AS-129: sectionKindEnum has no extra values beyond the DB CHECK constraint", () => {
    const dbValues = new Set(findLastCheckConstraintValues("tasks_section_kind_check"));
    for (const value of sectionKindEnum.options) {
      expect(dbValues.has(value)).toBe(true);
    }
  });
});
