# F058: Retire the 13 surviving Planner-task tests

**Milestone:** M4 follow-up (M4-scrutiny-1 major)
**Depends on:** F057 (F057 deletes some tests; F058 deletes the rest)

## Problem (AS-080)

These test files assert Planner task behaviour but were not deleted in F019:

- `tests/unit/f233-calendar-day-overflow.test.tsx`
- `tests/unit/f235-calendar-responsive-render.test.tsx`
- `tests/unit/f234-calendar-day-grid-wiring.test.ts`
- `tests/unit/f234-calendar-reschedule-plan.test.ts`
- `tests/unit/f027-calendar-realtime-wiring.test.tsx`
- `tests/unit/f009-calendar-realtime-subscription.test.ts`
- `tests/unit/f034-fix-realtime-bugs.test.ts`
- `tests/unit/f040-calendar-realtime-date-scope.test.ts`
- `tests/unit/f326-month-grid-datakey-wiring.test.tsx`
- `tests/unit/f326-calendar-day-grid-rerender.test.tsx`
- `tests/unit/f338-priority-a11y-contrast.test.tsx`
- `tests/unit/f009-workspace-status-options-project-scan.test.ts`
- `tests/integration/f234-calendar-drag-reschedule.test.ts`

## Steps

1. **Judgement call on `f234-calendar-drag-reschedule.test.ts`**: Read it. Check if
   `tests/integration/edit-task.test.ts` (or similar) covers the same date-fidelity assertions.
   - If yes → delete `f234-calendar-drag-reschedule.test.ts`.
   - If no → move the date-fidelity test cases to `tests/integration/edit-task.test.ts`
     or a new `tests/integration/task-date-edit.test.ts`, then delete `f234-calendar-drag-reschedule.test.ts`.
   The drag-reschedule Server Action itself is still live for My Tasks and the board, so
   the date-fidelity coverage should be preserved somewhere.

2. Delete all remaining files in the list above. Do not `describe.skip` — hard delete.

3. Also check if F057 already deleted some of these (via their subject module being gone).
   Delete what remains.

## Gate

```bash
npx tsc --noEmit
npx eslint --max-warnings=0
npx vitest run tests/unit
# Must match or improve on the 41/133 baseline (not introduce new FAILs)
```

Write handoff to missions/20260920-124226/handoffs/F058-handoff.md with Status COMPLETE.
Commit before exiting.
