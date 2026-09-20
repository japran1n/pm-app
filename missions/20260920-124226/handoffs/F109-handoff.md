# Handoff: F109 — Fix AS-069, render-level check for remaining 5 planner files

## Status
COMPLETE

## Assertions covered
AS-069: PASS — added `test_AS_069_no_capacity_figure_rendered_in_stacked_planner`, a render-level test that mounts the full `StackedPlanner` with two members and blocks (no capacity data anywhere in props) and asserts `document.body.textContent` never matches capacity/hours/utilization patterns. Verified with mutation testing: adding `<span>{40}h total loaded / {8}h booked</span>` to `stacked-planner.tsx` made the new test FAIL as expected, then reverted (confirmed no diff on the source file afterward).

## Files changed
tests/unit/f036-stacked-scroll-colour.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (only ran targeted on changed files, 0 warnings/errors)
`npx vitest run tests/unit/f036-stacked-scroll-colour.test.tsx` (0) — 9 tests passed

## Decisions made
- Scoped the new render test to `StackedPlanner` only, per spec Step 1 (the remaining "5 files" note in the spec's Problem section is imprecise — `week-view.tsx`, `week-time-grid.tsx`, `page.tsx`, and `components/calendar/week-view.tsx` are not directly renderable without heavy Supabase/server-data mocking; the spec's concrete "Fix" section only asks for a `StackedPlanner` render test plus a regex fix, so I followed the Fix section, not the Problem section's file count literally).
- Used the same prop shape as the existing F107 `StackedPlanner` render test (`test_AS_067_block_color_not_overridden_by_person_palette`) for consistency: `selectedUserIds`, `members`, `blocksByUser` (a `Map`), `weekKey`, `workspaceSlug`, `selfId`, `weekParam`.
- Regex for the render assertion follows the spec's Step 1 patterns almost verbatim, narrowing the percentage check to `/\d+%\s*(load|booked|capacity|utili)/i` to avoid false positives on time-of-day percentages, as instructed.
- For Step 2 (source-text sweep), added two new patterns to the existing `capacityPatterns` array in `test_AS_069_no_capacity_figure_in_any_planner_file`: `/\d+\s+hours?\b/i` ("12 hours") and `/\d+\s*\/\s*\d+\s*hrs?\b/i` ("8 / 40 hrs"), exactly as specified.
- AUTONOMOUS_DECISION: Did not add render tests for `week-view.tsx`, `week-time-grid.tsx`, or `page.tsx` since the spec's actionable "Fix" section (Steps 1 and 2) only asked for the `StackedPlanner` render test and the regex widening — treating the Problem section's "five files remain" as context/motivation rather than a literal five-file checklist, since page.tsx and week-view.tsx require significant server/data mocking to render and are already covered by the existing static source-text sweep (`test_AS_069_no_capacity_figure_in_any_planner_file`), which now has the widened regex from Step 2.

## Out-of-scope work needed
If stronger render-level coverage of `week-view.tsx`, `week-time-grid.tsx`, and `page.tsx` is desired (beyond the static source sweep), a future feature should set up the necessary Supabase/server mocks to render those components directly and apply the same textContent assertions used here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted the spec's Fix section (Steps 1 and 2) as the authoritative scope rather than the Problem section's "five files remain" framing, since Step 1 explicitly names only `StackedPlanner` for the new render test and Step 2 only asks for a regex fix in the source-text sweep (which already covers all seven planner files, now with the widened patterns).

## Notes for the next worker
The test file `tests/unit/f036-stacked-scroll-colour.test.tsx` experienced a transient edit-revert during this session (an intermediate edit was silently reverted by a concurrent file-watch/tool sync), which was caught by re-checking `grep -c "it("` against the expected count before committing. If future workers see edits to this file not "sticking," re-verify with `grep`/`git diff` before committing.
