# F002: Optimistic update for list-due-date-cell

**Milestone:** M1 — Optimistic UI hardening
**Estimated worker time:** 30 min
**Depends on:** none

## Assertion IDs covered
- AS-003: Changing a task's due date in the list view updates the date cell immediately without waiting for a server response.
- AS-004: If the server rejects a due-date change, the date cell reverts to its prior value and an error toast appears.

## Draft scope
- `list-due-date-cell.tsx`: add `React.useOptimistic` so the cell updates immediately on date select; revert on error; toast on failure.
- Same pattern as list-status-select.

## Files (approximate)
`components/task/list-due-date-cell.tsx`

## Notes
- MCP at run: none
- Check how the date picker triggers the mutation — may need to wrap the onChange handler

---

## Clarified implementation (from clarifications/F002-clarification.md)

- Pattern: `React.useOptimistic` wrapping existing `updateTaskDueDate` server action
- Data shape: Optimistic state: `Date | null`; null = no due date
- State location: Component-local via `useOptimistic`
- API contract: Calls existing server action; date as ISO string
- Failure handling: Auto-revert + `toast.error("Failed to update due date")`
- Empty state: Cell shows "No due date" or empty — existing rendering unchanged
- Validation: Date must be a valid Date object; server validates further
- Performance budget: <200ms; optimistic update is instant
- Access control: Inherits existing `canWrite` from server action
- Touches: `components/task/list-due-date-cell.tsx` only

### Follow-up decisions
- Overdue styling (red text) updates immediately based on optimistic date
- Clear-date action (setting null) also optimistic
- Date picker closes on select; no separate confirm needed
- Stop click propagation to prevent row opening sheet
- No loading spinner needed — date picker closes immediately

## Definition of done

- **Primary success test:** Unit test: date cell shows new date before server responds
- **Failure test:** Unit test: date reverts on server error
- **Manual verification:** Pick date in list view — cell updates without flicker
- **Side-effect verification:** Other cells unaffected
- **Evidence artifact:** Test output (vitest)
