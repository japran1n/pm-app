# Handoff: F023 — Read-only detail popover for another member's block — no save, no delete

## Status
COMPLETE

## Assertions covered
AS-044: PASS — clicking another member's block opens the same popover as before, now rendered with `isOwn={false}`, which shows all fields (title, time range, color, client-presentation toggle) disabled/read-only instead of a save button.
AS-045: PASS — with `isOwn={false}` the Save button and Delete button are both absent from the DOM (replaced with a read-only note), verified in `tests/unit/f023-readonly-popover.test.tsx`.

## Files changed
components/calendar/calendar-block-popover-form.tsx
components/calendar/calendar-block-chip.tsx
components/calendar/week-time-grid.tsx
tests/unit/f023-readonly-popover.test.tsx
missions/20260920-124226/features/F023-readonly-popover.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint components/calendar/calendar-block-popover-form.tsx components/calendar/calendar-block-chip.tsx components/calendar/week-time-grid.tsx tests/unit/f023-readonly-popover.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/f023-readonly-popover.test.tsx tests/unit/calendar-block-color-picker.test.tsx tests/unit/calendar-week-time-grid-live-resize.test.tsx` (0, 9 passed)
`npx vitest run $(find tests -iname "*calendar*")` (0 for unit tests; 1 pre-existing integration test `tests/integration/calendar-blocks-crud.test.ts` fails for unrelated live-Supabase-credential reasons, not touched by this feature)

## Decisions made
- Added `isOwn?: boolean` (default `true`) to `CalendarBlockPopoverForm` rather than a separate read-only component, so both existing render call sites (`calendar-block-chip.tsx` for month/day grid, `week-time-grid.tsx`'s `WeekBlockChip` for the week time-grid) keep one shared form/markup and just toggle affordances. Default `true` means the create-only popover (`add-block-popover.tsx`, which has no concept of "someone else's block") is unaffected without any change to that file.
- Disabled (not removed) all inputs when `isOwn === false` so the read-only view still shows the real values (title, time, color, client-presentation flag) per the clarified answer ("read-only means non-editable, not redacted").
- Replaced the Save/Delete button row with a one-line read-only note (`data-testid="calendar-block-readonly-note"`) instead of leaving an empty footer, for a clearer signal that the view is intentionally non-interactive.
- Added a defensive `if (!isOwn) return;` guard at the top of `handleSubmit` in case a future caller reaches the form via a path that skips hiding the submit button (e.g. Enter key on a disabled-but-still-focusable input); belt-and-braces alongside the missing button.
- While making this change, found `week-time-grid.tsx` had already been committed (by the serial F024 worker run) containing my in-progress edits to that same file since I hadn't committed yet at that point — confirmed via `git diff` that the file's current HEAD state matches exactly what this feature required, so no rework was needed; only `calendar-block-chip.tsx`, `calendar-block-popover-form.tsx`, and the new test were still uncommitted and are included in this commit.

## Out-of-scope work needed
None identified for this feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to disable inputs (not hide them) for the read-only view to satisfy "shows the real title" (AS-044/clarification note) while still satisfying "no save, no delete" (AS-045); this reads as the natural middle ground and matches the existing pattern in F021/F022 where ownership gates specific affordances (resize handles, drag) rather than the whole component.

## Notes for the next worker
- Ownership check reused verbatim from `lib/calendar/ownership.ts`'s `isOwnBlock(block, currentUserId)` — same predicate F020-F022 already wired through both grid views.
- No MCP tools used — pure client-component/UI feature, no live external service state involved.
