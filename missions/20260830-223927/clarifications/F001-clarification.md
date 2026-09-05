# F001 Clarification — Optimistic update for list-priority-select

_Generated: 2026-08-30T23:00:00Z_  _Mode: accept-and-continue (★ defaults)_

## Round A

1. **Implementation pattern** ★ Wrap existing mutation in `React.useOptimistic`; follow list-status-select pattern
2. **Data shape** ★ Local optimistic state mirrors the priority enum value; reverts automatically on transition end
3. **State location** ★ Component-local via `useOptimistic` — no global store
4. **API contract** ★ Calls existing `updateTaskPriority` server action unchanged
5. **Failure handling** ★ On error: `useOptimistic` auto-reverts; sonner `toast.error` with message
6. **Empty state** ★ N/A — field always has a value (default No Priority)
7. **Validation** ★ Priority value must be one of the existing enum; validated server-side
8. **Performance budget** ★ <200ms server action; optimistic update is instant
9. **Access control** ★ Respects existing `canWrite` check already in the server action
10. **Touches** ★ `components/task/list-priority-select.tsx` only

## Round B — Follow-ups

11. ★ Use `useOptimistic` directly in the component (no new hook for F001 — F007 extracts it)
12. ★ Display a spinner/muted state during pending transition
13. ★ Stop click propagation from priority cell (already done in status cell — match that)
14. ★ Toast error message: "Failed to update priority" + generic server message if available
15. ★ No rollback confirmation needed — silent revert is sufficient

## Definition of done

16. **Primary success test** ★ Unit test: priority cell shows new value before server responds
17. **Failure test** ★ Unit test: priority cell reverts when server action throws
18. **Manual verification** ★ Open task list, change priority — no flicker, instant response
19. **Side-effect verification** ★ Other list cells unaffected by priority change
20. **Evidence artifact** ★ Test output (vitest)
