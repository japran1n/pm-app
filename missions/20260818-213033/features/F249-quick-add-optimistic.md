# F249: optimistic quick add

**Milestone:** M17 — UX polish
**Estimated worker time:** 30 minutes
**Depends on:** F248

## Assertion IDs covered
- AS-481: the task appears immediately and is reconciled with the server result

## Draft scope
- Insert a provisional card with a temporary id, then reconcile with the returned row — including the task key, which only the server can assign.
- Failure removes the provisional card and restores the typed text into the input so nothing is lost.
- Realtime echo of the same insert must not produce a duplicate card.

## Files (approximate)
components/board/quick-add.tsx, components/board/board.tsx, lib/board/reconcile-realtime-task.ts

## Notes for clarification
- The realtime-echo duplicate is the likely bug here; mission 1's reconciliation helper already has the shape for it.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F249-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The realtime-echo duplicate is the likely bug here; mission 1's reconciliation helper already has the shape for it.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-481) has a named test or a written verification note.
