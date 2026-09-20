# Handoff: F131 — Fix AS-168/169: real migration discovery + semantic classifier

## Status
COMPLETE

## Assertions covered
AS-168: PASS — real `readdirSync`-based discovery over `supabase/migrations/` filtered to timestamp range `20261127120000`-`20261127149999` (finds 3 files, non-vacuous `toBeGreaterThan(0)` check). Content-floor regex anchored to first line only (no `/m` flag), requires 20+ non-whitespace chars after `--`. Verified with a real mutation test (see Evidence).
AS-169: PASS — comments (`--` line and `/* */` block) are stripped before classification so header prose can't misclassify a migration. Non-vacuity assertion (`expect(MISSION_MIGRATIONS.length).toBeGreaterThan(0)`) sits outside any conditional. Ordering check runs on real data.

## Files changed
tests/unit/m9-migration-headers.test.ts

## Commands run
`npx vitest run tests/unit/m9-migration-headers.test.ts --reporter=verbose` (0, both tests pass)
`npx tsc --noEmit` (0)
`git add tests/unit/m9-migration-headers.test.ts && git commit ...` (0)

## Decisions made
- Discovery now uses `readdirSync("supabase/migrations")` filtered by filename timestamp prefix against `MISSION_TIMESTAMP_MIN`/`MAX` (`20261127120000`/`20261127149999`), replacing the dead git pathspec + hardcoded fallback. This matches the exact 3 files that actually exist in that range: `20261127120000_discipline_estimates_nullable_minutes.sql`, `20261127130000_drop_page_components_description.sql`, `20261127140000_drop_node_meta_client_visible.sql`.
- Content-floor regex changed from `/^--\s+\S.{18,}/m` to `/^--\s+\S.{18,}/` applied to `content.split("\n")[0]` only, so a later line in the file can't rescue a bare first-line comment.
- Classifier strips `--` line comments and `/* */` block comments via `stripComments()` before running the additive/destructive regexes, per spec.
- AUTONOMOUS_DECISION: The real classifier surfaced a case not covered by the original spec text — `20261127120000_discipline_estimates_nullable_minutes.sql` contains `ALTER COLUMN ... DROP NOT NULL` plus `DROP CONSTRAINT`/`ADD CONSTRAINT` in the *same file*, so it matches both the additive and destructive regexes at the *same* timestamp. A naive `max(additive) < min(destructive)` check then compares `20261127120000` to itself and fails spuriously, even though there's no actual cross-file ordering hazard (a migration containing its own additive+destructive DDL in one transaction is self-consistent). I excluded timestamps present in *both* lists before computing max/min (`additiveOnly` / `destructiveOnly`), so the ordering check only fires across genuinely distinct files. This is the safest interpretation that satisfies the assertion text ("destructive migrations are never dated before the additive migrations they depend on") — a same-file dependency can't be violated by definition. Confirmed the fix is correct by inspecting the migration content directly (cat'd all 3 mission migration files).

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: See "same-timestamp additive+destructive in one file" note above under Decisions made — excluded self-overlapping timestamps from the cross-file ordering check rather than failing the suite on a false positive.

## Notes for the next worker
Mutation test was actually executed, not just documented:
1. `echo "-- x" > supabase/migrations/20261127130001_throwaway_test.sql`
2. Ran `npx vitest run tests/unit/m9-migration-headers.test.ts --reporter=verbose` — AS-168 FAILED as expected:
   ```
   FAIL  tests/unit/m9-migration-headers.test.ts > M9 migration headers (AS-168, AS-169) > AS-168: real discovery finds mission migrations and each has a leading -- comment with a real description
   AssertionError: supabase/migrations/20261127130001_throwaway_test.sql must have a first-line -- comment with a real description (>=20 chars beyond '--'): expected null to be truthy
   - Expected: true
   + Received: null
   Test Files  1 failed (1)
        Tests  1 failed | 1 passed (2)
   ```
3. `rm supabase/migrations/20261127130001_throwaway_test.sql`
4. Re-ran the suite — both tests PASS again:
   ```
   ✓ AS-168: real discovery finds mission migrations and each has a leading -- comment with a real description
   ✓ AS-169: destructive migrations are never dated before the additive migrations they depend on
   Test Files  1 passed (1)
        Tests  2 passed (2)
   ```

No MCP tools were needed for this feature (test-only change, no live Supabase schema/state touched).
