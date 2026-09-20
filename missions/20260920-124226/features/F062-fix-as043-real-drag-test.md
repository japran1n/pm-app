# F062: Fix AS-043 — find real drag implementation; fix vacuous test

**Milestone:** M5 follow-up (M5-scrutiny-1 major)
**Depends on:** F022

## Problem

`CalendarBlockChip` (which F022 modified) has no production call site — `calendar-day-grid.tsx`
was deleted in F057. The drag test asserts `data-draggable` and cursor class from the same
variable — mutating `disabled: false` plus unconditional `{...listeners}` leaves tests green.

## Fix

1. Find where drag-to-move is actually used in production (the real component in `week-time-grid.tsx`
   or wherever `WeekBlockChip` is defined). This is the component that renders in the Planner.

2. If `CalendarBlockChip` is genuinely dead (no production import), the test and implementation
   are exercising dead code. In that case: find `WeekBlockChip` (or the actual block component
   in `week-time-grid.tsx`) and ensure the drag-to-move gate is there.

3. Write a test that renders the LIVE component (the one that actually appears in `WeekView`),
   and verify:
   - own block → draggable (has drag listeners or `draggable` attribute)
   - other member's block → not draggable

4. The mutation `isOwnBlock always returns true` must break the new test.

## Gate

```bash
npx tsc --noEmit
npx eslint --max-warnings=0
npx vitest run tests/unit/f022-no-drag-other-blocks.test.tsx
# mutation: isOwnBlock always returns true → must fail ≥1 test
```

Write handoff to missions/20260920-124226/handoffs/F062-handoff.md with Status COMPLETE.
Commit before exiting.
