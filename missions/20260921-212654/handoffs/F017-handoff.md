# Handoff: F017 — repair-f265-and-baseline

## Status
COMPLETE

## Assertions covered
SB-004: PASS — HEAD failing-file set (46) is a strict subset of the pre-F001 baseline (47); no new failures.

## Files changed
tests/unit/f265-mobile-task-detail.test.tsx
missions/20260921-212654/baseline-failing-files.txt
missions/20260921-212654/handoffs/F017-handoff.md

## Commands run
`npx vitest run tests/unit/f265-mobile-task-detail.test.tsx` (0) 11/11 pass
`git worktree add --detach <scratchpad>/wt b16e1ce5` + `npx vitest run tests/unit --exclude '.claude/**'` in it (1, expected baseline failures) -> 47 failing files
`npx vitest run tests/unit` at HEAD (1, pre-existing failures) -> 46 failing files
`git worktree remove --force` (0)
`npm test` equivalent: the unit suite above; failures are baseline-only.

## Decisions made
- AS-518 test now queries `getAllByRole("button", {name:/Account menu/i})` and still asserts `max-md:min-h-11` on every match; assertion retained, not deleted.
- Baseline captured with node_modules symlinked into the worktree and .claude/** excluded via CLI (pre-F016 config lacked the exclude).
- Diff baseline vs HEAD: only difference is tests/unit/f041-final-gate.test.tsx, failing in baseline, passing at HEAD (fixed or flaky). No file fails at HEAD that did not fail in baseline.
- tsc/eslint not run: only a test file query changed.

## Out-of-scope work needed
None. Optionally check whether f041-final-gate is flaky.

## Blockers

## Autonomous decisions

## Notes for the next worker
Baseline list: missions/20260921-212654/baseline-failing-files.txt (sorted, repo-relative). Compare with the same JSON-reporter filter.
