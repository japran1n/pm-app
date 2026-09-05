# F007 Clarification — Shared useOptimisticAction helper

_Generated: 2026-08-30T23:00:00Z_  _Mode: accept-and-continue (★ defaults)_

## Round A

1. **Implementation pattern** ★ Thin custom hook `useOptimisticAction<T>` wrapping `useOptimistic` + toast-on-error pattern
2. **Data shape** ★ Generic: `<T>` is the field value type; hook takes current value, action fn, error message
3. **State location** ★ Each caller owns its own hook instance — no shared state
4. **API contract** ★ `const [optimisticValue, runAction] = useOptimisticAction(value, serverAction, errorMsg)`
5. **Failure handling** ★ Hook handles toast internally; caller doesn't need to catch
6. **Empty state** ★ N/A — utility hook
7. **Validation** ★ No validation in the hook; caller validates before calling `runAction`
8. **Performance budget** ★ Zero overhead — pure React hook
9. **Access control** ★ N/A — hook is pure client utility
10. **Touches** ★ New file `lib/hooks/use-optimistic-action.ts`; F001–F006 components refactored to use it

## Round B — Follow-ups

11. ★ Hook signature: `useOptimisticAction<T>(current: T, action: (v: T) => Promise<void | {error: string}>, errorMessage: string)`
12. ★ Returns `[optimisticValue: T, isPending: boolean, run: (newValue: T) => void]`
13. ★ `isPending` exposed so callers can show loading state
14. ★ If `action` returns `{error}`, show that message; otherwise show generic `errorMessage`
15. ★ Unit test the hook itself with a mock server action

## Definition of done

16. **Primary success test** ★ Unit test: hook returns optimistic value immediately and resolves correctly
17. **Failure test** ★ Unit test: hook reverts + calls toast on action rejection
18. **Manual verification** ★ All 5 previously-refactored components work identically to before
19. **Side-effect verification** ★ `tsc --noEmit` passes; no existing tests broken
20. **Evidence artifact** ★ Test output (vitest) + tsc output
