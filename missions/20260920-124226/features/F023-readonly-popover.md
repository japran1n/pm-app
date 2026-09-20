# F023: Read-only detail popover for another member's block — no save, no delete

**Canonical spec:** `missions/20260920-124226/features/F023-readonly-block-popover.md`
(this file mirrors that spec's filename as referenced by the orchestrator's
run instructions; see the canonical file for the milestone, estimate, and
clarification notes).

**Assertions:** AS-044, AS-045
**Depends on:** F020

## Context

F020 threaded `currentUserId` into the grid and created `isOwnBlock(block, currentUserId)`.
When clicking a calendar block, a popover/dialog appears. It showed the edit form for ALL
blocks. For blocks belonging to other members, it now shows a read-only view (no save
button, no delete button).

## What was done

1. `CalendarBlockPopoverForm` (`components/calendar/calendar-block-popover-form.tsx`) takes
   a new `isOwn?: boolean` prop, defaulting to `true` so existing create-only callers
   (`add-block-popover.tsx`) are unaffected.
2. When `isOwn === false`: all inputs (title, start/end time, client-presentation toggle,
   color swatches) render disabled/inert, and the Save/Delete button row is replaced with a
   read-only note (`data-testid="calendar-block-readonly-note"`). Submit is also a no-op
   defensively.
3. When `isOwn === true`: unchanged, editable form with Save and Delete.
4. Both consumers of the form now pass `isOwn={isOwnBlock(block, currentUserId)}`:
   - `components/calendar/calendar-block-chip.tsx` (month/day grid chip)
   - `components/calendar/week-time-grid.tsx`'s `WeekBlockChip` (week time-grid chip)

## Tests

`tests/unit/f023-readonly-popover.test.tsx`:
- `test_AS_044_isOwn_true_renders_save_and_delete_buttons`
- `test_AS_045_isOwn_false_hides_save_and_delete_buttons`

## Gate

```bash
npx tsc --noEmit
npx eslint --max-warnings=0
npx vitest run tests/unit/f023-readonly-popover.test.tsx
```
