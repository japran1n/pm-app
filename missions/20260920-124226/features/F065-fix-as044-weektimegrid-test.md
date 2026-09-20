# F065: Fix AS-044/045 — test popover ownership via WeekTimeGrid (live component)

**Milestone:** M5 follow-up (M5-scrutiny-2 blocker)
**Depends on:** F023, F063

## Problem

BOTH F063 attempts used `CalendarBlockChip` which has zero production call sites
(calendar-day-grid.tsx was deleted in F057). The live chip is `WeekBlockChip`, inline in
`components/calendar/week-time-grid.tsx:553`:
```tsx
isOwn={isOwnBlock(block, currentUserId)}
```

Mutating that to `isOwn={true}` passes all existing tests.

## Fix

Replace the chip-level tests in `tests/unit/f023-readonly-popover.test.tsx` with tests
that render `WeekTimeGrid` (the actual production component) and click a rendered block chip.

### Test setup

Render `<WeekTimeGrid>` with:
- `currentUserId="user-own"`
- Two blocks: one where `block.user_id === "user-own"`, one where `block.user_id === "user-other"`
- All other required props (days, hours range, etc.)

### Assertions

1. Click the other user's block chip → popover opens → assert no save button, no delete button
2. Click own block chip → popover opens → assert save button present, delete button present

### Mutation gate (MANDATORY to verify before committing)

In `week-time-grid.tsx`, change `isOwn={isOwnBlock(block, currentUserId)}` to `isOwn={true}`.
Run the tests — test 1 (other user's block) must FAIL. Restore before committing.

## Notes

- `WeekTimeGrid` may have many required props. Find the minimal set from existing tests
  (e.g., `f015-remove-task-strips.test.tsx` or `f021-no-resize-other-blocks.test.tsx`).
- The popover may render in a portal outside the component. Use `screen.getByRole` or
  `within(document.body)` to find buttons after clicking.
- Do NOT use `CalendarBlockChip` — it is dead code.

## Gate

```bash
npx vitest run tests/unit/f023-readonly-popover.test.tsx
npx tsc --noEmit
# Mutation: isOwn={true} in week-time-grid.tsx → other-user test must FAIL
# Restore
```

Write handoff to missions/20260920-124226/handoffs/F065-handoff.md with Status COMPLETE.
Commit before exiting.
