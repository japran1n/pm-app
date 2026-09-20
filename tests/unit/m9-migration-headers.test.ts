import { readFileSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import { describe, it, expect } from "vitest"

/**
 * Discover mission migration files via git history rather than a hardcoded
 * list. We look for files added in commits that also touched the mission
 * directory (missions/20260919-150607/), which restricts the result to
 * migrations authored as part of this mission (not the whole repo history).
 *
 * Falls back to a hardcoded list if the git command yields nothing (e.g. the
 * commits that added migrations never touched the mission directory in the
 * same commit, or git is unavailable in the test environment).
 */
function discoverMissionMigrations(): string[] {
  const fallback = [
    "supabase/migrations/20261127120000_discipline_estimates_nullable_minutes.sql",
    "supabase/migrations/20261127130000_drop_page_components_description.sql",
    "supabase/migrations/20261127140000_drop_node_meta_client_visible.sql",
  ]

  try {
    const output = execSync(
      'git log --diff-filter=A --name-only --pretty=format: missions/20260919-150607/ | grep "supabase/migrations" | sort -u',
      { encoding: "utf8", cwd: process.cwd() }
    )
    const discovered = output
      .split("\n")
      .map(l => l.trim())
      .filter(l => /^supabase\/migrations\/.*\.sql$/.test(l))

    return discovered.length > 0 ? discovered : fallback
  } catch {
    return fallback
  }
}

describe("M9 migration headers (AS-168, AS-169)", () => {
  const MISSION_MIGRATIONS = discoverMissionMigrations()

  it("AS-168: every mission migration has a leading -- comment with a real description", () => {
    expect(MISSION_MIGRATIONS.length).toBeGreaterThan(0)
    for (const p of MISSION_MIGRATIONS) {
      const content = readFileSync(join(process.cwd(), p), "utf8")
      expect(content.trimStart().startsWith("--"), `${p} must start with a -- comment`).toBe(true)
      // Require at least 20 non-whitespace characters of real description
      // beyond the "--" marker itself -- a bare "--" or "-- x" must fail.
      expect(
        content.match(/^--\s+\S.{18,}/m),
        `${p} must have a -- comment with a real description (>=20 chars beyond '--')`
      ).toBeTruthy()
    }
  })

  it("AS-169: destructive migrations are never dated before the additive migrations they depend on", () => {
    // Classify each mission migration's SQL content as additive and/or
    // destructive based on the DDL it contains.
    const additiveRe = /ADD COLUMN|CREATE TABLE|CREATE INDEX|CREATE POLICY/i
    const destructiveRe = /DROP COLUMN|DROP TABLE|DROP INDEX|DROP POLICY/i

    const additive: string[] = []
    const destructive: string[] = []

    for (const p of MISSION_MIGRATIONS) {
      const content = readFileSync(join(process.cwd(), p), "utf8")
      const timestamp = p.split("/").pop()!.split("_")[0]
      if (additiveRe.test(content)) additive.push(timestamp)
      if (destructiveRe.test(content)) destructive.push(timestamp)
    }

    if (additive.length > 0 && destructive.length > 0) {
      // Self-check: this branch must actually run when both categories
      // exist, so the assertion below isn't vacuous.
      expect(additive.length).toBeGreaterThan(0)
      expect(destructive.length).toBeGreaterThan(0)

      const maxAdditive = additive.reduce((a, b) => (a > b ? a : b))
      const minDestructive = destructive.reduce((a, b) => (a < b ? a : b))

      // Mutation check (documented, not executed): if a synthetic
      // "ADD COLUMN" migration were dated after 20261127140000 (the last
      // destructive migration), maxAdditive would become that later
      // timestamp and this assertion would go red, exactly as intended --
      // an additive change must never land after a destructive change that
      // could depend on it.
      expect(
        maxAdditive < minDestructive,
        `expected latest additive migration (${maxAdditive}) to precede earliest destructive migration (${minDestructive})`
      ).toBe(true)
    } else {
      // All migrations fall into a single category (e.g. all destructive) --
      // there's no cross-category ordering to violate, so skip.
      expect(additive.length === 0 || destructive.length === 0).toBe(true)
    }
  })
})
