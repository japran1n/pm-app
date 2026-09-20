# Handoff: F108 — Fix AS-019 day label rendering test

## Status
COMPLETE

## Assertions covered
AS-019: PASS — new test `test_AS_019_stacked_row_shows_mon_to_fri_labels` in tests/unit/f033-stacked-row-grid.test.tsx reads the rendered text content of each `stacked-day-N` column and asserts the labels equal `["Mon","Tue","Wed","Thu","Fri"]` in order, and that neither "Sun" nor "Sat" appear. Verified the mutation kills it: rotated `DAY_LABELS` in components/calendar/stacked-person-row.tsx to start with Sun (`{1:"Sun",2:"Mon",3:"Tue",4:"Wed",5:"Thu"}`), reran the test, it failed as expected, then reverted the component file (confirmed `git status` shows it clean/unchanged).

## Files changed
tests/unit/f033-stacked-row-grid.test.tsx

## Commands run
`npx vitest run tests/unit/f033-stacked-row-grid.test.tsx` (0) — 7/7 passed
`npx vitest run tests/unit/f033-stacked-row-grid.test.tsx` after mutating DAY_LABELS (1) — new test failed as expected, mutation reverted afterward
`npx eslint tests/unit/f033-stacked-row-grid.test.tsx components/calendar/stacked-person-row.tsx --max-warnings=0` (0)
`npx tsc --noEmit` (1) — pre-existing failures in an unrelated, already-modified-but-uncommitted file (tests/unit/f036-stacked-scroll-colour.test.tsx, referencing undefined `SwitcherMember`/`StackedPlanner`); not touched by this feature, not introduced by this change (confirmed via `git status`/`git log` showing that file was last committed by F105 and has separate uncommitted local edits from another session)

## Decisions made
- Found the DOM structure in components/calendar/stacked-person-row.tsx: no `columnheader` role exists; each day column is a `div[data-testid="stacked-day-{isoWeekday}"]` whose first child div renders the label text (`{DAY_LABELS[isoWeekday]}`). Used `.textContent` on the `stacked-day-N` testid nodes instead of a role query, since that's the actual DOM structure and it captures the same rendered text the assertion cares about (no blocks are rendered in the test, so `.textContent` is exactly the label).
- Kept the existing AS-019 testid-presence test in place (still valid, checks structural presence) and added the new rendered-text test as a sibling `it` block for AS-019, since the assertion is one behavior with two failure modes (columns present vs. columns correctly labeled).

## Out-of-scope work needed
tests/unit/f036-stacked-scroll-colour.test.tsx has pre-existing uncommitted local changes (not from this session) causing tsc errors (`Cannot find name 'SwitcherMember'`, `Cannot find name 'StackedPlanner'`) — likely missing imports from an in-progress edit in another worker/session. This is unrelated to F108/AS-019 and was left untouched per scope; a future worker or the orchestrator should investigate/fix or discard that file's uncommitted state.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `.textContent` on the existing `stacked-day-{isoWeekday}` testid nodes rather than `getAllByRole("columnheader")` as sketched in the spec, because the component has no `columnheader` role — this matches the "Read the component to understand actual DOM structure" instruction in the spec.

## Notes for the next worker
No MCP usage — pure frontend unit test fix, no external service touched. Full untargeted `npx tsc --noEmit` will show 2 errors from tests/unit/f036-stacked-scroll-colour.test.tsx that predate and are unrelated to this feature; do not attribute them to F108.
