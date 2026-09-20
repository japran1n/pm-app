# F111 — Fix AS-127: fixture-based parser proof + barrel parser hardening

_Mission: 20260919-150607_ _Milestone: M6 follow-up (scrutiny-2 FU-2 + FU-3)_

## Problem (AS-127)

Current `AS-127: parser throws on unknown constraint name` test would pass against a
hardcoded `Record<string, string[]>` with throw-on-miss. Nothing proves the parser
actually reads SQL files.

## Problem (barrel parser — FU-3)

- `parseBarrelExports` runs on raw source (comments not stripped)
- `export { x };` (no `from`) silently yields zero names
- Dead `precedingText` / `/type\s*$/` branch can delete real exports
- `collectFiles` scans whole repo including `missions/`, `scripts/`, `tests/`

## Fix

### CHECK parser (AS-127)

Add fixture directory `tests/fixtures/m6-check-guard/` with synthetic SQL files:
- `01_initial.sql`: defines `tasks_test_kind_check CHECK (kind in ('a', 'b'))`
- `02_widen.sql`: redefines it as `= ANY (ARRAY['a', 'b', 'c'])`
- `03_widen_any.sql`: redefines with another ANY form
- `04_drop.sql`: `drop constraint if exists tasks_test_kind_check`

Parameterize `findLastCheckConstraintValues(name, migrationsDir?)` to accept an
optional dir override for testing.

Add fixture-based tests:
```ts
describe('parser fixtures', () => {
  it('parses IN(...) form', () => {
    // only 01_initial.sql
    expect(parse('tasks_test_kind_check', fixture('01'))).toEqual(['a','b'])
  })
  it('parses ANY(ARRAY[...]) form, picks latest migration', () => {
    // 01 + 02: must pick 02's values
    expect(parse('tasks_test_kind_check', fixture('01-02'))).toEqual(['a','b','c'])
  })
  it('throws on drop-without-re-add', () => {
    // 01 + 04: drop is last
    expect(() => parse('tasks_test_kind_check', fixture('01-04'))).toThrow()
  })
  it('throws on unknown constraint name', () => {
    expect(() => parse('tasks_nonexistent_xyz', realMigrationsDir)).toThrow()
  })
})
```

Delete the current vacuous AS-127 test, replace with these fixture-based ones.
Also assert list length (not just set equality) in AS-128/AS-129 tests.

### Barrel parser hardening (FU-3)

In `tests/unit/m6-action-barrel-guard.test.ts`:
1. Strip comments before parsing barrel exports (already done in F107 for file scanning;
   apply same to parseBarrelExports)
2. If parser encounters `export { x }` with no `from`, call `expect.fail`
3. If parser encounters `export *` or `export default`, call `expect.fail`
4. Delete dead `precedingText` / `/type\s*$/` branch

NOTE: `collectFiles` scope restriction (to `app/`, `components/`, `lib/`) is handled
in F110. Do NOT duplicate that work here.

## Assertion: AS-127 (fixture-based proof that parser reads SQL)

Commit: `feat(F111): AS-127 fixture-based parser proof + barrel parser hardening`

Handoff: `missions/20260919-150607/handoffs/F111-handoff.md`
Include vitest output showing all fixture tests pass.
