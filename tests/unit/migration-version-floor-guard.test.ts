import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * P2-28: Migration version floor guard
 *
 * Enforces two invariants on the supabase/migrations/ directory:
 *
 * 1. FLOOR — the latest migration timestamp must be >= 20261126040000.
 *    This is the known baseline of the repo before the production-readiness
 *    fix session.  NEW migrations must always carry a timestamp GREATER than
 *    the current directory maximum.  Never back-date a new migration — it
 *    becomes a row in schema_migrations and past-dating it causes drift
 *    between the filesystem and the live database.
 *
 * 2. No two migrations may share the same 14-character timestamp prefix.
 *    Supabase applies migrations in lexicographic order; a collision means
 *    only one of the two files would win on a fresh apply, and the other
 *    would silently be absent from schema_migrations.
 *
 * NOTE: `00000000000000_baseline.sql` is the full-schema baseline snapshot,
 * not a regular migration.  It carries a sentinel timestamp by convention and
 * is excluded from all guards below.
 *
 * WARNING: Do NOT renumber existing migrations. Each timestamp is a row in
 * the schema_migrations table. Renaming a file that has already been applied
 * creates drift between the filesystem and the live database. See README.md §
 * "Database migrations" for the correct approach (npm run db:apply).
 */

const MIGRATIONS_DIR = join(
  new URL(".", import.meta.url).pathname,
  "../../supabase/migrations",
);

/**
 * The repo floor — the latest migration version present when this guard was
 * added.  The test fails if the directory no longer contains any migration at
 * or above this value, which would indicate the recent migrations were
 * erroneously deleted or renumbered.
 */
const FLOOR = "20261126040000";

/** Sentinel prefix used by the baseline snapshot — excluded from all checks. */
const BASELINE_PREFIX = "00000000000000";

function getRegularMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter(
    (f) => f.endsWith(".sql") && !f.startsWith(BASELINE_PREFIX),
  );
}

function extractTimestamp(filename: string): string | null {
  const prefix = filename.slice(0, 14);
  if (!/^\d{14}$/.test(prefix)) return null;
  return prefix;
}

describe("migration version floor guard", () => {
  const files = getRegularMigrationFiles();

  it("finds at least one regular migration file", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("every migration filename starts with a 14-digit timestamp", () => {
    const badFiles = files.filter((f) => extractTimestamp(f) === null);
    expect(badFiles).toEqual([]);
  });

  it(`the latest migration timestamp is >= ${FLOOR} (the repo floor)`, () => {
    const timestamps = files
      .map((f) => extractTimestamp(f))
      .filter((ts): ts is string => ts !== null);

    const max = timestamps.reduce(
      (a, b) => (b > a ? b : a),
      "00000000000000",
    );
    expect(max >= FLOOR).toBe(true);
  });

  it("no two migrations share the same timestamp prefix", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];

    for (const f of files) {
      const prefix = f.slice(0, 14);
      if (seen.has(prefix)) {
        duplicates.push(`${seen.get(prefix)} vs ${f}`);
      } else {
        seen.set(prefix, f);
      }
    }

    expect(duplicates).toEqual([]);
  });
});
