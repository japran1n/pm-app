# F006 Clarification — Optimistic My Tasks checkbox toggles

_Generated: 2026-08-30T23:00:00Z_  _Mode: accept-and-continue (★ defaults)_

## Round A

1. **Implementation pattern** ★ `React.useOptimistic` for checkbox checked state in personal-todo-list
2. **Data shape** ★ Optimistic state: boolean (checked = done status); maps to task status "Done" or equivalent
3. **State location** ★ Component-local per row via `useOptimistic`
4. **API contract** ★ Calls existing task status update server action with "Done" / previous status
5. **Failure handling** ★ Auto-revert + `toast.error("Failed to update task")`
6. **Empty state** ★ N/A — checkboxes only render when tasks exist
7. **Validation** ★ No special validation; server validates status enum
8. **Performance budget** ★ Instant optimistic; <200ms server
9. **Access control** ★ Only the assigned user sees My Tasks — inherits existing auth
10. **Touches** ★ `components/my-tasks/personal-todo-list.tsx`

## Round B — Follow-ups

11. ★ Checked row gets strikethrough styling immediately (optimistic)
12. ★ Unchecking removes strikethrough immediately (optimistic)
13. ★ The "done" status used for checkbox = the workspace's first "Done"-category status (or hardcoded "done" enum value)
14. ★ Rapid check/uncheck is safe: each optimistic call is independent; latest wins
15. ★ No undo toast needed (revert-on-error is sufficient)

## Definition of done

16. **Primary success test** ★ Unit test: checkbox + strikethrough update before server responds
17. **Failure test** ★ Unit test: checkbox reverts + toast on server error
18. **Manual verification** ★ Check task in My Tasks — immediate strikethrough; uncheck — immediate restore
19. **Side-effect verification** ★ Task list view and board view reconcile via realtime after server confirms
20. **Evidence artifact** ★ Test output (vitest)
