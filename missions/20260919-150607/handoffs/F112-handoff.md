# Handoff: F112 — Fix AS-127: runtime-generated fixtures so no hardcoded map can pass

## Status
COMPLETE

## Assertions covered
AS-127: PASS — 6 tests now exercise `findLastCheckConstraintValues` against runtime-generated SQL with randomUUID-based constraint names/values (plus the pre-existing real-migrations-dir check); no static fixture files remain, so a hardcoded lookup table cannot pass.

## Files changed
tests/unit/m6-check-value-guard.test.ts
tests/fixtures/m6-check-guard/ (deleted: 01_initial.sql, 02_widen_in.sql, 03_any_form.sql, 04_drop.sql)

## Commands run
`npx vitest run tests/unit/m6-check-value-guard.test.ts --reporter=verbose` (0)

```
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-127: parser reads SQL files — unknown constraint throws even with real migrations 10ms
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-128: pageKindEnum matches tasks_page_kind_check 8ms
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-129: sectionKindEnum matches tasks_section_kind_check 7ms
 ✓ tests/unit/m6-check-value-guard.test.ts > parser fixtures — runtime generated (AS-127) > AS-127: parses IN(...) form from a single file 1ms
 ✓ tests/unit/m6-check-value-guard.test.ts > parser fixtures — runtime generated (AS-127) > AS-127: picks latest migration when redefined (widen via IN) 1ms
 ✓ tests/unit/m6-check-value-guard.test.ts > parser fixtures — runtime generated (AS-127) > AS-127: parses = ANY (ARRAY[...]) form 1ms
 ✓ tests/unit/m6-check-value-guard.test.ts > parser fixtures — runtime generated (AS-127) > AS-127: throws when last mention is a drop (drop without re-add) 1ms
 ✓ tests/unit/m6-check-value-guard.test.ts > parser fixtures — runtime generated (AS-127) > AS-127: throws on unknown constraint name against real migrations dir 10ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
```

## Decisions made
- Kept the `migrationsDir` optional parameter on `findLastCheckConstraintValues` unchanged, as instructed.
- Replaced the `parser fixtures` describe block entirely with `parser fixtures — runtime generated (AS-127)`, using `beforeEach`/`afterEach` with `fs.mkdtempSync`/`fs.rmSync` to create/clean up a fresh temp dir per test, matching the spec's example pattern (used `fs.*`/`path.*`/`os.*` namespace imports already present in the file rather than introducing separate named imports, to minimize import churn).
- Constraint name and values are generated once per test file load via `randomUUID()` at the `describe` scope (as in the spec's example) — this is fine because each test writes its own temp dir contents, so no cross-test interference occurs despite the shared name.
- Removed the now-unused `FIXTURES_DIR` constant and `fixtureDir()` helper since no test references static fixtures anymore.
- Deleted `tests/fixtures/m6-check-guard/` entirely per spec instruction.
- Left the two other describe blocks (`m6 CHECK constraint vs Zod enum drift guard` with AS-127/128/129 against real migrations, and the top-level AS-127 real-dir throw test) untouched — they were not part of the "parser fixtures" block being replaced.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the existing `fs`/`path`/`os` default imports already in the file (e.g. `fs.mkdtempSync`, `fs.writeFileSync`, `fs.rmSync`) instead of adding new named imports (`mkdtempSync`, `writeFileSync`, `rmSync`) as literally shown in the spec's illustrative code snippet, to avoid duplicate/unused imports and keep the file's existing import style consistent. Behavior is identical.

## Notes for the next worker
No MCP tools were needed for this feature — it's a pure test-file refactor with no external service interaction.
