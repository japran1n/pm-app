# F001: Optimistic update for list-priority-select

**Milestone:** M1 — Optimistic UI hardening
**Estimated worker time:** 30 min
**Depends on:** none

## Assertion IDs covered
- AS-001: Changing a task's priority in the list view updates the priority cell immediately without waiting for a server response.
- AS-002: If the server rejects a priority change, the priority cell reverts to its prior value and an error toast appears.

## Draft scope
- `list-priority-select.tsx`: replace any awaited server-action pattern with `React.useOptimistic`; revert on error; show sonner error toast on failure.
- Follow the same pattern already used in `list-status-select.tsx` (F057/F158).
- No schema or server-action changes needed.

## Files (approximate)
`components/task/list-priority-select.tsx`

## Notes
- MCP at run: none (pure application-code change)
- Pattern reference: `components/task/list-status-select.tsx` — already uses the correct optimistic pattern

---

## Clarified implementation (from clarifications/F001-clarification.md)

- Pattern: `React.useOptimistic` wrapping existing mutation; follow list-status-select pattern
- Data shape: Local optimistic state mirrors the priority enum value; reverts automatically on transition end
- State location: Component-local via `useOptimistic` — no global store
- API contract: Calls existing `updateTaskPriority` server action unchanged
- Failure handling: On error: `useOptimistic` auto-reverts; `toast.error` with message
- Empty state: N/A — field always has a value (default No Priority)
- Validation: Priority value must be one of the existing enum; validated server-side
- Performance budget: <200ms server action; optimistic update is instant
- Access control: Respects existing `canWrite` check already in the server action
- Touches: `components/task/list-priority-select.tsx` only

### Follow-up decisions
- Use `useOptimistic` directly in the component (F007 extracts shared hook later)
- Display spinner/muted state during pending transition
- Stop click propagation from priority cell (match status cell behaviour)
- Toast error message: "Failed to update priority"
- Silent revert is sufficient — no undo toast

## Definition of done

- **Primary success test:** Unit test: priority cell shows new value before server responds
- **Failure test:** Unit test: priority cell reverts when server action throws
- **Manual verification:** Open task list, change priority — no flicker, instant response
- **Side-effect verification:** Other list cells unaffected by priority change
- **Evidence artifact:** Test output (vitest)
