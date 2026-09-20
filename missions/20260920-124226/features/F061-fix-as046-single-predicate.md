# F061: Fix AS-046 — route canCreateInColumn through isOwnBlock

**Milestone:** M5 follow-up (M5-scrutiny-1 blocker)
**Depends on:** F020, F024

## Problem

`components/calendar/week-time-grid.tsx` has a local `canCreateInColumn` function that
re-derives `columnUserId === currentUserId` inline. The AS-046 invariant requires that ALL
M5 affordances call `isOwnBlock` (from `lib/calendar/ownership.ts`) rather than re-implementing
the check.

## Fix

In `week-time-grid.tsx`, replace `canCreateInColumn(columnUserId)` with
`isOwnBlock({ user_id: columnUserId } as CalendarBlock, currentUserId)` — or create a
simpler helper `isOwnColumn(columnUserId, currentUserId)` in `lib/calendar/ownership.ts`
and call that.

The key invariant: changing `isOwnBlock` in `lib/calendar/ownership.ts` to `return true`
must break ALL of F021, F022, F023, F024 unit tests.

## Gate

```bash
# Mutation: change isOwnBlock to always return true
# → ALL of these must fail at least one test each:
npx vitest run tests/unit/f021-no-resize-other-blocks.test.tsx tests/unit/f022-no-drag-other-blocks.test.tsx tests/unit/f023-readonly-popover.test.tsx tests/unit/f024-no-create-on-others.test.tsx
# Restore isOwnBlock

npx tsc --noEmit
npx eslint --max-warnings=0
```

Write handoff to missions/20260920-124226/handoffs/F061-handoff.md with Status COMPLETE.
Commit before exiting.
