# Handoff: F024 — No create affordance and no drag-to-create on another member's column or row; own grid unaffected

## Status
COMPLETE

## Assertions covered
AS-047: PASS — clicking empty grid area where `columnUserId === currentUserId` shows the "+" affordance and (per `test_AS_049_own_column_drag_gesture_creates_pending_block`) a drag from it produces a create-drag preview.
AS-048: PASS — `test_AS_048_other_column_no_create_affordance` confirms the "+" trigger never renders when `columnUserId !== currentUserId`.
AS-049: PASS — `test_AS_049_other_column_drag_gesture_does_not_create` confirms a raw pointerdown/move/up sequence directly on another member's column never opens the create popover or shows a drag preview.

## Files changed
components/calendar/week-time-grid.tsx
lib/calendar/week-grid.ts
tests/unit/f024-no-create-on-others.test.tsx
missions/20260920-124226/features/F024-no-create-on-others.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint --max-warnings=0` (0)
`npx vitest run tests/unit/f024-no-create-on-others.test.tsx` (0, 4 tests passed)
`npx vitest run tests/unit/f020-ownership-predicate.test.ts tests/unit/f021-no-resize-other-blocks.test.tsx tests/unit/f022-no-drag-other-blocks.test.tsx` (0, 7 tests passed — no regression in related ownership guards)
`npx vitest run` (full suite; 292 test files failed / 573 passed, unrelated to this feature — see Notes)

## Decisions made
- Added an optional `userId` field to `CalendarWeekDay` (`lib/calendar/week-grid.ts`) rather than
  inventing a separate parallel type, since M7's stacked layout is expected to populate this same
  field per rendered person-row. Today's single-column-per-day view never sets it, so
  `WeekTimeGrid` falls back to `day.userId ?? currentUserId`, making the guard a no-op for the
  current product surface exactly as the clarified spec calls for.
- Added one shared predicate `canCreateInColumn(columnUserId)` used both to gate the "+" trigger's
  render condition and inside `handleColumnPointerDown` (the single handler both the click-start and
  drag-to-create gesture already funnel through, per the existing code's own doc comments), rather
  than duplicating the check — matches "click-to-create and drag-to-create share one code path" as
  written by the prior worker's comments in this file.
- No MCP usage — this is a pure client-side UI feature, no external service touched.

## Out-of-scope work needed
- F032 (stacked multi-person layout) will need to actually populate `CalendarWeekDay.userId` with
  real per-row values when it renders multiple people's rows; this feature only adds the field and
  the guard that consumes it.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: The task prompt's "Tests" section described AS-047/048/049 slightly
differently from the assertion text already drafted in
`missions/20260920-124226/features/F024-no-create-others.md` (a plan-stage draft file with a
different filename, without the "-on-"). I treated the task prompt given directly to me (including
its literal "Tests" section) as the authoritative clarified spec, since it was passed to me as the
enriched feature assignment, and wrote the feature spec file at the exact path requested
(`F024-no-create-on-others.md`, note the "-on-"), leaving the earlier plan-draft file
(`F024-no-create-others.md`) untouched since I don't have clarification-phase context indicating
which is canonical and it isn't mine to overwrite.

## Notes for the next worker
- Full `npx vitest run` on this working tree shows 292 failed test files unrelated to this feature
  (e.g. `tests/unit/list-due-date-cell-optimistic.test.tsx` timeout failures). `git status` shows
  uncommitted modifications to `components/calendar/calendar-block-chip.tsx`,
  `components/calendar/calendar-block-popover-form.tsx`, and `missions/20260920-124226/plan.md` that
  predate this session and were not made by this worker — the mass failures track those files, not
  `week-time-grid.tsx`/`week-grid.ts`. Targeted runs of this feature's test plus the F020/F021/F022
  ownership-guard tests (the closest-related existing coverage) all pass cleanly, and `tsc`/`eslint`
  are clean across the whole repo.
- The "+" hover create-affordance and the drag-to-create gesture already shared one code path
  (`handleColumnPointerDown`) before this feature; the F024 guard sits at the top of that one
  function plus the trigger's render condition, so both click and drag are covered by a single
  check.
