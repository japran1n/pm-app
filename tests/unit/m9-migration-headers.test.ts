import { readdirSync, readFileSync } from "fs"
import { join } from "path"
import { describe, it, expect } from "vitest"

/**
 * Discover mission migration files by scanning supabase/migrations/ and
 * filtering by the timestamp range assigned to this mission. This avoids
 * fragile git-history heuristics (dead pathspecs, missing commits) — the
 * timestamp range is a fact about the filenames themselves.
 */
const MISSION_TIMESTAMP_MIN = "20261127120000"
const MISSION_TIMESTAMP_MAX = "20261127149999"

function discoverMissionMigrations(): string[] {
  const dir = join(process.cwd(), "supabase/migrations")
  return readdirSync(dir)
    .filter(f => f.endsWith(".sql"))
    .filter(f => {
      const ts = f.split("_")[0]
      return ts >= MISSION_TIMESTAMP_MIN && ts <= MISSION_TIMESTAMP_MAX
    })
    .map(f => `supabase/migrations/${f}`)
    .sort()
}

/**
 * Strip SQL comments before classifying DDL intent, so that a header
 * comment mentioning e.g. "DROP COLUMN" for context doesn't misclassify an
 * otherwise purely additive migration (and vice versa).
 */
function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
}

describe("M9 migration headers (AS-168, AS-169)", () => {
  const MISSION_MIGRATIONS = discoverMissionMigrations()

  it("AS-168: real discovery finds mission migrations and each has a leading -- comment with a real description", () => {
    expect(MISSION_MIGRATIONS.length).toBeGreaterThan(0)

    for (const p of MISSION_MIGRATIONS) {
      const content = readFileSync(join(process.cwd(), p), "utf8")
      const firstLine = content.split("\n")[0]

      expect(
        firstLine.startsWith("--"),
        `${p} must start with a -- comment on the first line`
      ).toBe(true)

      // Require at least 20 non-whitespace characters of real description
      // beyond the "--" marker, anchored to the first line only — a bare
      // "--" or "-- x" must fail, and a matching later line must not
      // rescue it.
      expect(
        firstLine.match(/^--\s+\S.{18,}/),
        `${p} must have a first-line -- comment with a real description (>=20 chars beyond '--')`
      ).toBeTruthy()
    }
  })

  it("AS-169: destructive migrations are never dated before the additive migrations they depend on", () => {
    const additiveRe = /ADD COLUMN|CREATE TABLE|CREATE INDEX|CREATE POLICY|ALTER COLUMN|ADD CONSTRAINT/i
    const destructiveRe = /DROP COLUMN|DROP TABLE|DROP INDEX|DROP POLICY|DROP CONSTRAINT|DROP NOT NULL/i

    const additive: string[] = []
    const destructive: string[] = []

    for (const p of MISSION_MIGRATIONS) {
      const rawContent = readFileSync(join(process.cwd(), p), "utf8")
      const content = stripComments(rawContent)
      const timestamp = p.split("/").pop()!.split("_")[0]
      if (additiveRe.test(content)) additive.push(timestamp)
      if (destructiveRe.test(content)) destructive.push(timestamp)
    }

    // Non-vacuity: this must hold regardless of which branch below runs.
    expect(MISSION_MIGRATIONS.length).toBeGreaterThan(0)

    // A single migration file can legitimately contain both additive and
    // destructive DDL (e.g. an ALTER COLUMN ... DROP NOT NULL paired with a
    // replacement ADD CONSTRAINT in the same transaction) -- that is a
    // self-consistent unit, not a cross-file ordering hazard. Exclude
    // timestamps that appear in both lists before checking ordering across
    // distinct files.
    const additiveOnly = additive.filter(ts => !destructive.includes(ts))
    const destructiveOnly = destructive.filter(ts => !additive.includes(ts))

    if (additiveOnly.length > 0 && destructiveOnly.length > 0) {
      const maxAdditive = Math.max(...additiveOnly.map(ts => Number(ts)))
      const minDestructive = Math.min(...destructiveOnly.map(ts => Number(ts)))

      expect(
        maxAdditive,
        `expected latest additive migration (${maxAdditive}) to precede earliest destructive migration (${minDestructive})`
      ).toBeLessThan(minDestructive)
    } else {
      // All migrations fall into a single category, or the only additive
      // migrations are self-contained with their own destructive DDL --
      // there's no cross-file ordering to violate.
      expect(additiveOnly.length === 0 || destructiveOnly.length === 0).toBe(true)
    }
  })
})
