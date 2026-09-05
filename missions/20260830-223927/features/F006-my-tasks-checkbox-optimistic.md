# F006: Optimistic My Tasks checkbox toggles

**Milestone:** M1 — Optimistic UI hardening
**Estimated worker time:** 30 min
**Depends on:** none

## Assertion IDs covered
- AS-012: Checking a task done in My Tasks marks it visually complete before the server confirms.
- AS-013: If a My Tasks completion toggle fails, the checkbox reverts to its prior state and an error toast appears.
- AS-014: Unchecking a completed task in My Tasks marks it incomplete immediately without waiting for the server.

## Draft scope
- `personal-todo-list.tsx`: wrap the "mark complete / incomplete" action in `useOptimistic`.
- Checkbox state flips immediately; on error: revert + toast.
- Both directions: checking and unchecking.

## Files (approximate)
`components/my-tasks/personal-todo-list.tsx`

## Notes
- MCP at run: none
- Read personal-todo-list.tsx first — it currently has no optimistic pattern

---

## Clarified implementation (from clarifications/F006-clarification.md)

- Pattern: `React.useOptimistic` for checkbox checked state
- Data shape: Optimistic state: boolean (checked = done status); maps to task status "Done" or equivalent
- State location: Component-local per row via `useOptimistic`
- API contract: Calls existing task status update server action with "Done" / previous status
- Failure handling: Auto-revert + `toast.error("Failed to update task")`
- Empty state: N/A — checkboxes only render when tasks exist
- Validation: No special validation; server validates status enum
- Performance budget: Instant optimistic; <200ms server
- Access control: Only the assigned user sees My Tasks — inherits existing auth
- Touches: `components/my-tasks/personal-todo-list.tsx`

### Follow-up decisions
- Checked row gets strikethrough styling immediately (optimistic)
- Unchecking removes strikethrough immediately (optimistic)
- The "done" status = workspace's first "Done"-category status or hardcoded "done" enum
- Rapid check/uncheck is safe: each optimistic call is independent; latest wins
- No undo toast needed — revert-on-error is sufficient

## Definition of done

- **Primary success test:** Unit test: checkbox + strikethrough update before server responds
- **Failure test:** Unit test: checkbox reverts + toast on server error
- **Manual verification:** Check task in My Tasks — immediate strikethrough; uncheck — immediate restore
- **Side-effect verification:** Task list view and board view reconcile via realtime after server confirms
- **Evidence artifact:** Test output (vitest)
