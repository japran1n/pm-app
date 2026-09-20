# F063: Fix AS-044/AS-045 — test the chip→popover ownership wiring

**Milestone:** M5 follow-up (M5-scrutiny-1 major)
**Depends on:** F023

## Problem

`f023-readonly-popover.test.tsx` feeds `isOwn` directly to `CalendarBlockPopoverForm`.
This tests the form component but NOT the wiring in the chip that derives `isOwn` from
`isOwnBlock(block, currentUserId)`. The wiring could be inverted at the call site and all
tests would still pass.

## Fix

Add a test in `tests/unit/f023-readonly-popover.test.tsx` (or a new file) that:

1. Renders the CHIP component (CalendarBlockChip or WeekBlockChip — the one that contains
   the popover trigger and computes `isOwn` from `isOwnBlock`).
2. Provides a block where `block.user_id !== currentUserId`.
3. Opens the popover (clicks the block chip).
4. Asserts: no save button, no delete button, readonly note present.

This fails if the chip passes `isOwn={true}` to the form regardless of ownership.

Also add the mirror test:
- block where `block.user_id === currentUserId` → popover has save and delete buttons.

## Gate

```bash
npx vitest run tests/unit/f023-readonly-popover.test.tsx
npx tsc --noEmit
# mutation: in the chip, change isOwnBlock(...) to true → must fail the new "other member" test
```

Write handoff to missions/20260920-124226/handoffs/F063-handoff.md with Status COMPLETE.
Commit before exiting.
