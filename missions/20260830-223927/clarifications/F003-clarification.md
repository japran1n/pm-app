# F003 Clarification — Optimistic status change in task detail sheet

_Generated: 2026-08-30T23:00:00Z_  _Mode: accept-and-continue (★ defaults)_

## Round A

1. **Implementation pattern** ★ `React.useOptimistic` in the status selector sub-component of task-detail-sheet
2. **Data shape** ★ Optimistic state: status string/object matching existing TaskStatus type
3. **State location** ★ Component-local in the status selector; sheet passes down current value
4. **API contract** ★ Calls existing `updateTaskStatus` server action
5. **Failure handling** ★ Auto-revert + `toast.error("Failed to update status")`
6. **Empty state** ★ N/A — status always set
7. **Validation** ★ Status must be valid; server validates
8. **Performance budget** ★ Instant optimistic; <200ms server
9. **Access control** ★ Inherits existing sheet-level permission check
10. **Touches** ★ `components/task/task-detail-sheet.tsx` and/or its status sub-component

## Round B — Follow-ups

11. ★ Status badge color updates immediately with optimistic value
12. ★ Dropdown closes on selection; pending state shown while in-flight
13. ★ Realtime event arriving during pending transition is reconciled after transition settles
14. ★ Error toast includes status name that failed: "Failed to set status to Done"
15. ★ No skeleton needed — badge renders with optimistic value throughout

## Definition of done

16. **Primary success test** ★ Unit test: badge shows new status before server responds
17. **Failure test** ★ Unit test: badge reverts on server error
18. **Manual verification** ★ Open detail sheet, change status — badge updates instantly
19. **Side-effect verification** ★ List view row (if visible behind sheet) also reconciles via realtime
20. **Evidence artifact** ★ Test output (vitest)
