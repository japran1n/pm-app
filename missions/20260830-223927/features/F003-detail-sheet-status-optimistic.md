# F003: Optimistic status change in task detail sheet

**Milestone:** M1 — Optimistic UI hardening
**Estimated worker time:** 30 min
**Depends on:** none

## Assertion IDs covered
- AS-005: Changing a task's status in the task detail sheet updates the status badge immediately.
- AS-006: If the server rejects a status change in the detail sheet, the badge reverts and an error toast appears.

## Draft scope
- Find the status selector inside `task-detail-sheet.tsx` (or its sub-component).
- Wrap the mutation in `useOptimistic`; revert on error with toast.
- Visual: status badge updates instantly, no flicker.

## Files (approximate)
`components/task/task-detail-sheet.tsx` (and sub-components it delegates to)

## Notes
- MCP at run: none
- Read task-detail-sheet.tsx first to find where status mutation is called

---

## Clarified implementation (from clarifications/F003-clarification.md)

- Pattern: `React.useOptimistic` in the status selector sub-component of task-detail-sheet
- Data shape: Optimistic state: status string/object matching existing TaskStatus type
- State location: Component-local in the status selector; sheet passes down current value
- API contract: Calls existing `updateTaskStatus` server action
- Failure handling: Auto-revert + `toast.error("Failed to update status")`
- Empty state: N/A — status always set
- Validation: Status must be valid; server validates
- Performance budget: Instant optimistic; <200ms server
- Access control: Inherits existing sheet-level permission check
- Touches: `components/task/task-detail-sheet.tsx` and/or its status sub-component

### Follow-up decisions
- Status badge color updates immediately with optimistic value
- Dropdown closes on selection; pending state shown while in-flight
- Realtime event arriving during pending transition reconciled after transition settles
- Error toast: "Failed to set status to Done" (include status name)
- No skeleton needed — badge renders with optimistic value throughout

## Definition of done

- **Primary success test:** Unit test: badge shows new status before server responds
- **Failure test:** Unit test: badge reverts on server error
- **Manual verification:** Open detail sheet, change status — badge updates instantly
- **Side-effect verification:** List view row reconciles via realtime
- **Evidence artifact:** Test output (vitest)
