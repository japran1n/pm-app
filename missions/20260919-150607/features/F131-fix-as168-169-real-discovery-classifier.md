# F131 — Fix AS-168/169: real migration discovery + semantic classifier

_Mission: 20260919-150607_ _Milestone: M9_ _Parent: F126, F127_

## Problem

**AS-168**: The `discoverMissionMigrations()` git command uses a pathspec that prevents migration files from ever appearing — dead code. The hardcoded fallback always runs silently.

**AS-169**: The SQL classifier is correct but the non-vacuity assertion sits inside `if (additive.length > 0 && ...)` — when there are no additive migrations the ordering check is skipped silently via `expect(true).toBe(true)`.

Additional issues:
- Content floor uses `/m` flag (matches anywhere in file, not just first line)
- Comments in SQL mislead the classifier (a `-- DROP COLUMN` in a header comment misclassifies an additive migration)

## Fix

Rewrite `tests/unit/m9-migration-headers.test.ts` completely:

### Discovery (AS-168)

Replace the git-based discovery with `readdirSync`:

```ts
import { readdirSync, readFileSync } from "fs"
import { join } from "path"

const MISSION_TIMESTAMP_MIN = "20261127120000"
const MISSION_TIMESTAMP_MAX = "20261127149999"

function discoverMissionMigrations(): string[] {
  const dir = join(process.cwd(), "supabase/migrations")
  const files = readdirSync(dir)
    .filter(f => f.endsWith(".sql"))
    .filter(f => {
      const ts = f.split("_")[0]
      return ts >= MISSION_TIMESTAMP_MIN && ts <= MISSION_TIMESTAMP_MAX
    })
    .map(f => `supabase/migrations/${f}`)
    .sort()
  return files
}
```

Immediately assert `expect(files.length).toBeGreaterThan(0)` so a bad timestamp range fails loudly.

### Content floor (AS-168)

- Anchor to **first line** only (remove `/m` flag)
- Require `--` followed by at least 20 non-whitespace characters
- Pattern: `/^--\s+\S.{18,}/` (no `/m`) applied to `content.split("\n")[0]`

### SQL classifier (AS-169)

Before classifying, strip comments:
```ts
function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")  // strip line comments
    .replace(/\/\*[\s\S]*?\*\//g, "")  // strip block comments
}
```

Expand additive regex to catch: `ADD COLUMN|CREATE TABLE|CREATE INDEX|CREATE POLICY|ALTER COLUMN|ADD CONSTRAINT`
Expand destructive regex to catch: `DROP COLUMN|DROP TABLE|DROP INDEX|DROP POLICY|DROP CONSTRAINT|DROP NOT NULL`

### Non-vacuity (AS-169)

Move the self-check OUTSIDE the `if` guard:
```ts
// Even if all migrations are one type, assert the classifier found at least one file
expect(missionMigrations.length).toBeGreaterThan(0)

if (additive.length > 0 && destructive.length > 0) {
  const maxAdditive = Math.max(...additive.map(ts => Number(ts)))
  const minDestructive = Math.min(...destructive.map(ts => Number(ts)))
  expect(maxAdditive).toBeLessThan(minDestructive)
} else {
  // All same type is fine (no ordering violation possible) — but assert why:
  expect(additive.length === 0 || destructive.length === 0).toBe(true)
  // Note: this branch means no ordering test runs, which is correct —
  // all-destructive or all-additive missions have no ordering constraint.
}
```

Remove the "documented, not executed" mutation comment.

### Verify

Run `npx vitest run tests/unit/m9-migration-headers.test.ts --reporter=verbose` — pass.
Run `npx tsc --noEmit` — exit 0.

**Mutation verification (must be documented as actually run)**:
- Add a temp file `supabase/migrations/20261127999999_test_throwaway.sql` with content `-- ` (bare comment). AS-168 should fail. Then delete it and verify suite is green again.
- This must be described as EXECUTED in the handoff, not just documented.

Commit and write handoff to `missions/20260919-150607/handoffs/F131-handoff.md`.
