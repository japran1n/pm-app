# F004 Clarification — Optimistic priority change in task detail sheet

_Generated: 2026-08-30T23:00:00Z_  _Mode: accept-and-continue (★ defaults)_

## Round A

1. **Implementation pattern** ★ `React.useOptimistic` in priority selector inside task-detail-sheet
2. **Data shape** ★ Optimistic state: priority enum value
3. **State location** ★ Component-local via `useOptimistic`
4. **API contract** ★ Calls existing `updateTaskPriority` server action
5. **Failure handling** ★ Auto-revert + `toast.error("Failed to update priority")`
6. **Empty state** ★ N/A — defaults to No Priority
7. **Validation** ★ Server-side enum validation
8. **Performance budget** ★ Instant optimistic; <200ms server
9. **Access control** ★ Inherits sheet permission check
10. **Touches** ★ `components/task/task-detail-sheet.tsx` priority sub-component

## Round B — Follow-ups

11. ★ Priority icon/badge updates immediately with optimistic value
12. ★ Same `useOptimistic` pattern as F003 for consistency
13. ★ Dropdown closes on selection
14. ★ Error toast: "Failed to set priority to High"
15. ★ No separate confirm step needed

## Definition of done

16. **Primary success test** ★ Unit test: priority badge shows new value before server responds
17. **Failure test** ★ Unit test: priority reverts on server error
18. **Manual verification** ★ Open detail sheet, change priority — instant response
19. **Side-effect verification** ★ List row priority cell reconciles via realtime
20. **Evidence artifact** ★ Test output (vitest)
