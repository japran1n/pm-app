# F004: Optimistic priority change in task detail sheet

**Milestone:** M1 — Optimistic UI hardening
**Estimated worker time:** 30 min
**Depends on:** none

## Assertion IDs covered
- AS-007: Changing a task's priority in the task detail sheet updates the priority badge immediately.
- AS-008: If the server rejects a priority change in the detail sheet, the badge reverts and an error toast appears.

## Draft scope
- Priority selector inside `task-detail-sheet.tsx`.
- `useOptimistic` wrapping the priority mutation; revert + toast on failure.

## Files (approximate)
`components/task/task-detail-sheet.tsx`

## Notes
- MCP at run: none
- Same pattern as F003; read F003 handoff first if available

---

## Clarified implementation (from clarifications/F004-clarification.md)

- Pattern: `React.useOptimistic` in priority selector inside task-detail-sheet
- Data shape: Optimistic state: priority enum value
- State location: Component-local via `useOptimistic`
- API contract: Calls existing `updateTaskPriority` server action
- Failure handling: Auto-revert + `toast.error("Failed to update priority")`
- Empty state: N/A — defaults to No Priority
- Validation: Server-side enum validation
- Performance budget: Instant optimistic; <200ms server
- Access control: Inherits sheet permission check
- Touches: `components/task/task-detail-sheet.tsx` priority sub-component

### Follow-up decisions
- Priority icon/badge updates immediately with optimistic value
- Same `useOptimistic` pattern as F003
- Dropdown closes on selection
- Error toast: "Failed to set priority to High" (include priority name)
- No separate confirm step

## Definition of done

- **Primary success test:** Unit test: priority badge shows new value before server responds
- **Failure test:** Unit test: priority reverts on server error
- **Manual verification:** Open detail sheet, change priority — instant response
- **Side-effect verification:** List row priority cell reconciles via realtime
- **Evidence artifact:** Test output (vitest)
