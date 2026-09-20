# Handoff: F106 — Fix AS-069 render-level capacity figure guard

## Status
COMPLETE

## Assertions covered
AS-069: PASS — `test_AS_069_no_capacity_figure_rendered_in_planner_header` and `test_AS_069_no_capacity_figure_rendered_in_stacked_row` render the real `PlannerHeader` and `StackedPersonRow` components and assert on `document.body.textContent`. Verified the mutation catch: temporarily added `<span>{32}h total · {80}% booked</span>` to `PlannerHeader`, re-ran the suite, `test_AS_069_no_capacity_figure_rendered_in_planner_header` failed as required, then reverted (confirmed via `git diff` returning empty).

## Files changed
- tests/unit/f036-stacked-scroll-colour.test.tsx (added two render-level AS-069 tests, a `next/navigation` `useRouter`/`usePathname`/`useSearchParams` mock, and `ResizeObserver`/`scrollIntoView` jsdom polyfills; kept the existing source-text sweep as a supplementary, coarser guard per the spec's "Replace or supplement" wording)

Note: this file is also touched concurrently by feature F107 (`test_AS_067_block_color_not_overridden_by_person_palette`, using `StackedPlanner`/`SwitcherMember`). Both features' additions coexist in the file as committed by F107's commit `27302957`; my own render-level AS-069 tests and the `next/navigation` mock they require are present in that same commit's content (verified by re-reading the file and confirming both sets of tests currently pass together).

## Commands run
`npx tsc --noEmit` (0)
`npx eslint tests/unit/f036-stacked-scroll-colour.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/f036-stacked-scroll-colour.test.tsx` (0, 8/8 passed)
`npx vitest run tests/unit/f036-stacked-scroll-colour.test.tsx` with mutation applied to `components/calendar/planner-header.tsx` (1 failed as expected — `test_AS_069_no_capacity_figure_rendered_in_planner_header`), then reverted

## Decisions made
- Kept the F105 source-text sweep test in place rather than deleting it — it still catches hardcoded capacity strings and the spec said "Replace or supplement," so supplementing is safer than removing existing coverage.
- Used `PlannerHeader`'s real prop shape (`rangeLabel`, `peopleSwitcher: { members, selectedUserIds, selfId, weekParam }`) rather than the spec's illustrative-only prop names (`weekLabel`, `members`, `selectedUserIds` at top level) — read the component source first per the spec's own Step 2 instruction ("Read PlannerHeader's actual props to get the correct prop names").
- Added a `next/navigation` mock (`useRouter`/`usePathname`/`useSearchParams`) because `PlannerHeader` renders `PeopleSwitcherUrlBound`, which calls `useRouter()` and throws "invariant expected app router to be mounted" under plain jsdom rendering without a Next.js App Router context. This is the same pattern used by other component tests in the suite (e.g. `f088-planner-header-lift.test.tsx`).
- `StackedPersonRow` render test uses a full-day block (09:00–17:00 UTC) with no `userLabel`-derived capacity text — the component has no capacity/utilisation rendering path at all, so this test is a straightforward regression guard against a future addition.

## Out-of-scope work needed
None identified beyond what F107 is already handling in the same file (AS-067 person-palette regression, unrelated to AS-069).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to supplement rather than replace the F105 source-text sweep, since it still has value for the majority of the 7 planner files that were never rendered by any test, and the spec explicitly allowed "Replace or supplement."

## Notes for the next worker
- This test file (`tests/unit/f036-stacked-scroll-colour.test.tsx`) is being edited concurrently by multiple AS-069/AS-067 follow-up features (F105, F106, F107). If you touch it next, re-read it fully before editing — git status showed no diff for my last edit because a concurrently-running worker (F107) had already committed a version of the file containing both my render-level AS-069 tests and their own AS-067 `StackedPlanner` test.
- Mutation-testing recipe for any future capacity-figure assertion: apply the mutation, run the targeted vitest file, confirm the specific test fails, revert, confirm `git diff` on the touched component file is empty before committing.
