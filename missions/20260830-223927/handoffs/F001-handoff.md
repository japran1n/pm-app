# Handoff: F001 — Optimistic update for list-priority-select

## Status
COMPLETE

## Assertions covered
AS-001: PASS — test_AS_001_priority_cell_shows_new_value_immediately_before_server_responds asserts the select shows "urgent" while the mocked `editTask` promise is still unresolved.
AS-002: PASS — test_AS_002_priority_cell_reverts_and_shows_error_toast_when_server_action_throws asserts the select reverts to "medium" and `toast.error("Failed to update priority")` fires once `editTask` resolves `ok: false`.

## Files changed
components/task/list-priority-select.tsx
tests/unit/list-priority-select-optimistic.test.tsx

## Commands run
`npx tsc --noEmit -p .` (0)
`npx eslint components/task/list-priority-select.tsx tests/unit/list-priority-select-optimistic.test.tsx` (0)
`npx vitest run tests/unit/list-priority-select-optimistic.test.tsx` (0)
`npx vitest run tests/unit` (0) — 180 files / 1394 tests passed, including the new file

## Decisions made
- Replaced `useInlineFieldEdit` (the shared hand-rolled local-state hook `list-status-select.tsx` and other list cells use) with `React.useOptimistic` + `useTransition` directly inside the component, per this feature's Clarified implementation ("Use `useOptimistic` directly in the component (F007 extracts shared hook later)"). Touches only `components/task/list-priority-select.tsx`, as scoped.
- No manual revert logic is needed on failure: `useOptimistic`'s optimistic value is derived from the `priority` prop each render, so once the enclosing transition settles without that prop having changed, React automatically falls back to the base (server) value on its own — this is what satisfies AS-002's "reverts to its prior value." The component's own responsibility on failure is only the `toast.error("Failed to update priority")` call (per the clarification's exact wording).
- `editTask` (`lib/actions/tasks.ts`) is called unchanged with `{ priority: next }`, same server action the task detail sheet's Priority Select already uses — no server-action or schema changes, per the clarified "API contract" answer.
- Kept the existing `canEdit`/`canWrite` viewer gate, `stopPropagation`-equivalent click behaviour (unchanged from before — the `<Select>` itself already contains clicks), and the existing `disabled={isSaving || !canEdit}` on the trigger during the pending transition (spinner/muted-state requirement from the clarification's follow-up decisions — `isSaving` from `useTransition` covers this).
- Test approach: the real `@base-ui/react` `<Select>` is pointer-event-driven and unreliable to drive under jsdom (documented precedent: `tests/unit/f325-board-toolbar-groupby-none.test.tsx`). Since `ListPrioritySelect`'s own optimistic/revert/toast logic lives entirely in its `handleChange`, not inside the Select primitive, the test mocks `@/components/ui/select` with a bare native `<select>` wired to the same `value`/`onValueChange` contract and drives it with a real DOM `change` event through the REAL `handleChange`.
- Used `vi.doMock` + dynamic `import()` per test (rather than a single top-of-file `vi.mock`) so each test can supply a different `editTask` mock (success-pending vs. failure). Added `vi.resetModules()` in `beforeEach` — without it, the second dynamic import reused the first test's already-evaluated (and cached) `list-priority-select` module, so its `editTask` closure never switched to the second mock, silently making the AS-002 test check the wrong behaviour.

## Out-of-scope work needed
- F007 (already referenced in the clarification and existing code comments) is expected to extract a shared `useOptimistic`-based hook so `list-status-select.tsx`, `list-due-date-cell.tsx`, and this component share one implementation instead of `list-priority-select.tsx` now being the only cell using `useOptimistic` directly while the others still use `useInlineFieldEdit`/hand-rolled state. Not done here — out of this feature's scope per "Touches: components/task/list-priority-select.tsx only."
- No other out-of-scope work observed.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept the toast error message as the clarified exact string "Failed to update priority" (clarification's "Toast error message" follow-up decision), rather than propagating the server's own `result.error` text (which `list-status-select.tsx` does for its own toast). This matches the clarification's explicit answer over the sibling component's existing convention.

## Notes for the next worker
- The stale header comment in `list-priority-select.tsx` referencing `lib/hooks/use-inline-field-edit.ts` was updated to point at the new `React.useOptimistic` implementation instead — worth double-checking during F007's hook extraction that this comment (and this file's dependency on `useOptimistic` directly) is accounted for.
- `lib/hooks/use-inline-field-edit.ts` itself was NOT modified — `list-status-select.tsx`, `tags-editor.tsx`, and any other current consumers are unaffected.
- MCP: none used, per this feature's Notes ("MCP at run: none — pure application-code change").
