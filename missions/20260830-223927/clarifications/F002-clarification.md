# F002 Clarification — Optimistic update for list-due-date-cell

_Generated: 2026-08-30T23:00:00Z_  _Mode: accept-and-continue (★ defaults)_

## Round A

1. **Implementation pattern** ★ `React.useOptimistic` wrapping existing `updateTaskDueDate` server action
2. **Data shape** ★ Optimistic state: `Date | null`; null = no due date
3. **State location** ★ Component-local via `useOptimistic`
4. **API contract** ★ Calls existing server action; date as ISO string
5. **Failure handling** ★ Auto-revert + `toast.error("Failed to update due date")`
6. **Empty state** ★ Cell shows "No due date" or empty — existing rendering unchanged
7. **Validation** ★ Date must be a valid Date object; server validates further
8. **Performance budget** ★ <200ms; optimistic update is instant
9. **Access control** ★ Inherits existing `canWrite` from server action
10. **Touches** ★ `components/task/list-due-date-cell.tsx` only

## Round B — Follow-ups

11. ★ Overdue styling (red text) updates immediately based on optimistic date
12. ★ Clear-date action (setting null) also optimistic
13. ★ Date picker closes on select; no separate confirm needed
14. ★ Stop click propagation to prevent row opening sheet
15. ★ No loading spinner needed — date picker closes immediately

## Definition of done

16. **Primary success test** ★ Unit test: date cell shows new date before server responds
17. **Failure test** ★ Unit test: date reverts on server error
18. **Manual verification** ★ Pick date in list view — cell updates without flicker
19. **Side-effect verification** ★ Other cells unaffected
20. **Evidence artifact** ★ Test output (vitest)
