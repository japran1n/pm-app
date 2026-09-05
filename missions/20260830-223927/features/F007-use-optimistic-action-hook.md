# F007: Shared useOptimisticAction helper

**Milestone:** M1 — Optimistic UI hardening
**Estimated worker time:** 30 min
**Depends on:** F001, F002, F003, F004, F005, F006

## Assertion IDs covered
(no new assertions — this refactor makes F001–F006 consistent)

## Draft scope
- Create `lib/hooks/use-optimistic-action.ts`: thin hook wrapping `useOptimistic` + toast-on-error.
- Retrofit F001–F006 components to use it.
- No behaviour change; `tsc --noEmit` must pass.

## Files (approximate)
`lib/hooks/use-optimistic-action.ts`, then the six components from F001–F006.

## Notes
- MCP at run: none
- Read all 6 components before writing the hook to ensure the abstraction fits all callers

---

## Clarified implementation (from clarifications/F007-clarification.md)

- Pattern: Generic hook `useOptimisticAction<T>` wrapping `useOptimistic` + toast-on-error
- Data shape: Generic `<T>` is the field value type
- State location: Each caller owns its own hook instance — no shared state
- API contract: `const [optimisticValue, isPending, runAction] = useOptimisticAction(value, serverAction, errorMsg)`
- Failure handling: Hook handles toast internally; caller doesn't need to catch
- Empty state: N/A — utility hook
- Validation: No validation in hook; caller validates before calling `runAction`
- Performance budget: Zero overhead — pure React hook
- Access control: N/A
- Touches: New `lib/hooks/use-optimistic-action.ts`; 6 components refactored

### Follow-up decisions
- Signature: `useOptimisticAction<T>(current: T, action: (v: T) => Promise<void | {error: string}>, errorMessage: string)`
- Returns `[optimisticValue: T, isPending: boolean, run: (newValue: T) => void]`
- `isPending` exposed so callers can show loading state
- If action returns `{error}`, show that message; otherwise show generic `errorMessage`
- Unit test the hook itself with a mock server action

## Definition of done

- **Primary success test:** Unit test: hook returns optimistic value immediately and resolves correctly
- **Failure test:** Unit test: hook reverts + calls toast on action rejection
- **Manual verification:** All 5 previously-refactored components work identically
- **Side-effect verification:** `tsc --noEmit` passes; no existing tests broken
- **Evidence artifact:** Test output (vitest) + tsc output
