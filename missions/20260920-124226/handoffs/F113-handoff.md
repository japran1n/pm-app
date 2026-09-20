# Handoff: F113 — Fix AS-064/AS-065 drag DOM order + week key format

## Status
COMPLETE

## Assertions covered
AS-064: PASS — `test_AS_064_drag_reorders_rows` now asserts DOM order (not just URL order) after re-rendering the component with the post-drag `people=` order; verified against a `splice + reverse()` mutation in `handleDragEnd` and confirmed the test fails (2 tests fail) under that mutation, then reverted.
AS-065: PASS — `test_AS_065_weekParam_preserved_on_reorder` and all other fixtures now use the real `YYYY-MM-DD` Monday-anchored week key format (`2026-09-14`, `2026-09-21`) instead of the rejected ISO week format (`2026-W38`/`2026-W39`).

## Files changed
tests/unit/f035-stacked-reorder.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/f035-stacked-reorder.test.tsx` (0, 6/6 passed)
Manual mutation check: patched `components/calendar/stacked-planner.tsx` to add `nextOrder.reverse()` after the splice in `handleDragEnd`, reran the suite (2/6 failed, including the new DOM-order assertion), then restored the original file from a backup and reran the suite clean (6/6 passed).

## Decisions made
- `lib/calendar/week-nav.ts` doesn't itself define `parseWeekKey`/`currentWeekKey` (it only re-exports `buildWeekNavHref`); confirmed the correct format by cross-checking the existing fixture (`weekKey="2026-09-14"`) already used by `renderPlanner()` in the same test file and the feature spec's own worked example (`2026-09-14` = Monday of week 38). Replaced all `2026-W38`/`2026-W39` occurrences with `2026-09-14`/`2026-09-21` respectively (`2026-09-21` is the following Monday, week 39).
- For the DOM-order assertion, discovered that `StackedPlanner`'s row order is driven purely by the `selectedUserIds` prop — `handleDragEnd` only calls `router.replace()` with the new `?people=` order and does not reorder any local/DOM state itself (that's the app's actual contract: the URL is the source of truth, and a reload picks it up). A raw "check DOM order right after firing the drag keystrokes" assertion would therefore be vacuously true/false regardless of correctness, since the DOM never reorders in-place. Instead, the test now takes the `ids` order recovered from the captured `router.replace` URL and re-renders `StackedPlanner` with that as `selectedUserIds` (simulating the reload a real navigation would trigger), then asserts the rendered `stacked-row-draggable-*` elements appear in that exact order. This still fully catches the `splice + reverse()` mutation described in the spec (verified above) because a reversed splice produces a different `ids` array, which produces a different (wrong) DOM order on re-render.
- Did not need to add new `data-testid` attributes to `stacked-person-row.tsx` — the existing `stacked-row-draggable-${userId}` testid on the `SortableRow` wrapper in `stacked-planner.tsx` already uniquely identifies each row and was sufficient for the DOM order assertion.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Implemented the DOM-order assertion via "capture post-drag order from the URL, re-render with it, then assert DOM order" rather than a literal "check DOM order immediately after the drag gesture" as sketched in the spec's example snippet, because the latter doesn't reflect how this component actually works (order changes are persisted via URL/reload, not local re-sort state). The chosen approach preserves the spec's intent (DOM order must reflect the real post-drag order, not just be inferable from a pairwise URL check) and was confirmed via the mutation test.

## Notes for the next worker
- `git status` at session start showed `tests/unit/f036-stacked-scroll-colour.test.tsx` already modified/staged from a prior process (not touched by this worker). It was swept into this commit as a side effect of `git commit` picking up the pre-existing staged change alongside this feature's `git add tests/unit/f035-stacked-reorder.test.tsx`. Its diff (adding more candidate files + patterns to the AS-069 capacity-figure scan) is unrelated to F113 and was not authored or reviewed as part of this task — flag if it needs separate attribution/review.
- No MCP tools used; this is a pure local test-file fix with no external service touched.
