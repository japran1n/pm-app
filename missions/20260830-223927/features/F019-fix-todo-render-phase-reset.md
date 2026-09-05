# F019: Fix My Tasks render-phase optimistic reset (FU-I)

**Milestone:** M1 — Optimistic UI hardening (follow-up)
**Estimated worker time:** 25 min
**Depends on:** F015

## Assertion IDs covered
- AS-012: Checking task marks it complete immediately (survives router refresh)
- AS-014: Unchecking works immediately (survives router refresh)

## Scope

`components/my-tasks/personal-todo-list.tsx:28-31` — on `router.refresh()`, the component re-renders with fresh server data. If the server data arrives before the action completes, the optimistic state is silently overwritten with the pre-toggle value. No toast is shown.

Fix: ensure the optimistic checkbox state is not silently discarded on re-render during an in-flight toggle. Options:
- Use a `useTransition`-aware approach that prevents the state reset until the transition settles
- OR track in-flight toggle IDs and skip the server-data reset for those todos while a toggle is pending

Add a test that simulates a `router.refresh()` arriving before the toggle action resolves, and asserts the checkbox stays in the optimistic state during the transition, then settles to the server-confirmed value.

## Files
`components/my-tasks/personal-todo-list.tsx`, `tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx`

## Notes
- Read the current render-reset logic at lines 28-31 before implementing
- Do NOT change the toggle action or setTodos success path from F015

## Definition of done
- AS-012: PASS — optimistic state survives a router.refresh() during toggle
- AS-014: PASS — same for uncheck direction
