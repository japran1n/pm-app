# F126 — Fix AS-168: discover mission migrations via git, improve content floor

_Mission: 20260919-150607_ _Milestone: M9_ _Parent: F049_

## Problem

The test hardcodes only 2 migration files but this mission added 3 (it misses `20261127120000_discipline_estimates_nullable_minutes.sql`). Also the predicate `content.trimStart().startsWith("--")` is too weak — a bare `--` would pass.

## Fix

In `tests/unit/m9-migration-headers.test.ts`:

1. Replace the hardcoded array with discovery. Use `execSync` to get mission migration files:
   ```ts
   import { execSync } from "child_process"
   const missionMigrations = execSync(
     'git log --diff-filter=A --name-only --pretty=format: missions/20260919-150607/ | grep "supabase/migrations" | sort -u',
     { encoding: "utf8" }
   ).split("\n").filter(Boolean)
   ```
   If git isn't available, fall back to a hardcoded list that includes all 3: `20261127120000`, `20261127130000`, `20261127140000`.

2. Raise the content floor: require the comment to have at least 20 characters (beyond just `--`). The pattern `content.match(/^--\s+.{20,}/m)` ensures a real description is present.

3. Keep the ordering test (AS-169 is fixed in F127 — don't touch it here).

4. Run `npx vitest run tests/unit/m9-migration-headers.test.ts --reporter=verbose` — pass.
5. Run `npx tsc --noEmit` — exit 0.
6. Commit and write handoff to `missions/20260919-150607/handoffs/F126-handoff.md`.
