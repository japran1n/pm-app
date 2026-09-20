# Handoff: F105 — Fix AS-069 capacity figure sweep

## Status
COMPLETE

## Assertions covered
AS-069: PASS — test_AS_069_no_capacity_figure_in_any_planner_file scans all 7 planner component/page files with 6 capacity-figure regex patterns; verified mutation (`<span>32h total · 80% load</span>` added to planner-header.tsx) causes the test to fail, then restored and confirmed passing.

## Files changed
tests/unit/f036-stacked-scroll-colour.test.tsx

## Commands run
`npx vitest run tests/unit/f036-stacked-scroll-colour.test.tsx` (0) — 5/5 passing after fix
`npx vitest run tests/unit/f036-stacked-scroll-colour.test.tsx` (1) — mutation run, 1 failed as expected (AS-069 test caught the injected capacity string)
`npx tsc --noEmit` (0)
`npx eslint tests/unit/f036-stacked-scroll-colour.test.tsx --max-warnings=0` (0)

## Decisions made
- Replaced the old narrow `AS-069` test (2 files, 5 patterns) with the exact test body specified in the feature spec (7 files, 6 patterns), keeping the file's existing `readFileSync`/`path` imports rather than introducing `fs.readFileSync(...)` aliasing since `readFileSync` was already imported directly.
- Removed the now-unused `rowSource` const (previously only read by the old AS-069 test) to keep eslint's `no-unused-vars` rule at 0 warnings; `stacked-person-row.tsx` is still covered because it's one of the 7 files scanned by the new sweep.
- Verified the mutation must be in actual JSX/code, not a comment — first attempt used a leading comment line, which the test's comment-stripping regex correctly ignored (test still passed). Second attempt added `<span>32h total · 80% load</span>` inside the component's JSX return, which correctly failed the test. This is expected behavior of the comment-stripping in the assertion and confirms the test only flags real (non-comment) source text.

## Out-of-scope work needed
None identified within this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept `readFileSync` (already imported in the file) instead of switching to the `fs.readFileSync` naming shown in the spec's illustrative code block, since the spec's intent is the regex sweep behavior, not the literal import alias, and the file already had `readFileSync`/`path` imported for the pre-existing AS-067/AS-068 tests.

## Notes for the next worker
- The test file `tests/unit/f036-stacked-scroll-colour.test.tsx` now contains AS-067, AS-068, and AS-069 assertions together (this predates this feature and was not changed).
- Mutation verification: adding a capacity-shaped string to any of the 7 scanned files' JSX will fail `test_AS_069_no_capacity_figure_in_any_planner_file`; confirmed with `planner-header.tsx` and restored via git-tracked backup (no diff remained after restore, confirmed with `git diff`).
- Did not run the full repo-wide `npx eslint .` (large surface, out of scope for this single-file fix); ran targeted eslint against the changed file only, per the "gates" list intent of validating this feature's own changes. Full tsc --noEmit was run project-wide and passed with no output.
