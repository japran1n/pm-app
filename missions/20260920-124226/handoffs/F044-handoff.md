# Handoff: F044 — Fix collation and test mapping

## Status
COMPLETE

## Assertions covered
AS-058: PASS — `orderPeopleForWholeTeam` sort now uses `a.name.localeCompare(b.name, "en", { sensitivity: "base" })`; added non-ASCII test ("Ärla" sorts before "Zebra") to tests/unit/planner-people-selection.test.ts. Verified via `npx vitest run tests/unit/planner-people-selection.test.ts` (24/24 pass).
AS-072: PASS — test labels in tests/unit/planner-stacked-window.test.ts corrected to match validation-contract.md: entirely-before/after-window cases -> AS-020, Saturday/Sunday exclusion cases -> AS-021, partial-overlap/clip cases -> AS-022. Verified via `npx vitest run tests/unit/planner-stacked-window.test.ts` (14/14 pass).

## Files changed
lib/calendar/people-selection.ts (locale-aware sort — landed via concurrent F043 commit d8d2c317, see Notes)
tests/unit/planner-people-selection.test.ts (AS-058 non-ASCII test added, AS-015 vacuous `view: "week"` test removed — landed via concurrent F043 commit d8d2c317)
tests/unit/planner-stacked-window.test.ts (AS-020/AS-021/AS-022 label corrections — committed by this feature, commit 4d784942)

## Commands run
`npx vitest run tests/unit/planner-people-selection.test.ts` (0, 24 passed)
`npx vitest run tests/unit/planner-people-selection.test.ts tests/unit/planner-stacked-window.test.ts` (0, 38 passed)
`npx vitest run tests/unit` (1, 133 failed / 3251 passed — pre-existing failures unrelated to this feature's two files, from other concurrent features' in-flight work; both files this feature owns are 100% green)
`git commit` (0)

## Decisions made
- This mission's run loop executes workers concurrently against the same shared git working tree. While this worker was reading/editing `lib/calendar/people-selection.ts` and its test file, a concurrent worker (F043) independently made the identical locale-sort fix plus the AS-015 removal, and committed first (commit d8d2c317, timestamped seconds after this worker's local test run). Since the working tree already reflected the correct final state and matched the required diff exactly, no re-commit of those two files was needed or attempted — re-diffing confirmed zero delta between the committed state and this feature's intended edits.
- For the stacked-window test file, F042 (also running concurrently) had substantially rewritten `clipBlockToStackedWindow` to return an array of per-day segments (multi-day/segment support) and had already renamed two of the three mislabeled tests, but with different (still-incorrect per validation-contract.md) IDs, and left the "entirely outside" and Saturday/Sunday tests unlabeled. This worker fixed labels against the ground-truth assertion text in `missions/20260920-124226/validation-contract.md` (AS-020 = entirely outside window, AS-021 = weekend, AS-022 = partial overlap/clipped), not against the spec's literal old-state description, since the file had moved on from that old state.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used validation-contract.md's actual AS-020/AS-021/AS-022 text as the source of truth for relabeling tests/unit/planner-stacked-window.test.ts, rather than the feature spec's literal description of the old (pre-F042) mislabeling, because F042 had already changed the file's structure (array-returning API, additional multi-day-segment tests) before this worker ran. The spec explicitly anticipated this ("F042 is also editing this file... if F042 hasn't run yet, make the fixes now") but the scenario that occurred was a third state: F042 partially relabeled with still-wrong IDs. Mapping against the immutable contract text was the safest resolution.

## Notes for the next worker
- This mission's orchestrator appears to run multiple F0NN workers against one shared checkout without per-worker branches/worktrees, causing edits from different workers to land in each other's commits when they touch overlapping files in the same window (observed here between F042/F043/F044, all touching lib/calendar/*.ts and their matching test files). Future workers touching lib/calendar/people-selection.ts or lib/calendar/stacked-window.ts should re-`git diff`/`git status` immediately before committing to confirm what's actually uncommitted and attributable to them, since another worker may commit first.
- Full `tests/unit` run has 41 failing files / 133 failing tests unrelated to this feature (e.g. tests/unit/list-due-date-cell-optimistic.test.tsx) — these belong to other in-flight features and were pre-existing before this worker started; not investigated further per scope.
