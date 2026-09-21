# Handoff: F016 — vitest-exclude-worktrees

## Status
COMPLETE

## Assertions covered
SB-004: PASS — bare `npx vitest run tests/unit` (no --exclude flag) no longer collects .claude/worktrees; failing-file set identical to the flagged baseline (47 files, all pre-existing).

## Files changed
vitest.config.ts
tests/unit/f016-vitest-exclude-worktrees.test.ts
missions/20260921-212654/handoffs/F016-handoff.md

## Commands run
`npx vitest run tests/unit` (1) — 47 failed / 486 passed files, all pre-existing failures
`npx vitest run tests/unit` with config stashed + explicit --exclude flags (baseline) (1) — 47 failing files
`diff base.txt after.txt` (1) — sole difference: the new f016 test fails under the stashed (old) config, as intended; otherwise identical
`npx vitest run tests/unit/f016-vitest-exclude-worktrees.test.ts` (0)
`npx eslint vitest.config.ts tests/unit/f016-vitest-exclude-worktrees.test.ts` (0)

## Decisions made
- Added ".claude/**" to test.exclude rather than deleting the stale worktree (untracked/not ours to delete).
- Failing-file diff vs baseline: no new failures, no fixed files (only the new test differs, and it passes with the fix).
- tsc not run separately; change is a string in config plus a small test.

## Out-of-scope work needed
The 47 pre-existing failing unit test files (e.g. app-sidebar-trash-nav cookies-outside-request-scope errors) remain.

## Blockers

## Autonomous decisions

## Notes for the next worker
Pre-existing uncommitted changes in layout.tsx and f120-chat-bugs.test.ts were not touched.
