# F225: dragging between swimlanes changes the grouped field

**Milestone:** M16 — Views
**Estimated worker time:** 45 minutes
**Depends on:** F224

## Assertion IDs covered
- AS-420: dropping into another lane updates the grouped field
- AS-425: ordering within a column still works while grouped

## Draft scope
- Drop handler resolving both the target column and the target lane, writing status and the grouped field in one atomic action.
- Position maths runs within the (lane, column) slice so ordering stays stable.
- Optimistic update with rollback on partial failure, following mission 1's F102 pattern.

## Files (approximate)
components/board/board.tsx, lib/actions/tasks.ts, lib/board/position.ts

## Notes for clarification
- Reassigning by drag on a multi-assignee task is ambiguous — decide between replace-all and add.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F225-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Reassigning by drag on a multi-assignee task is ambiguous — decide between replace-all and add.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-420, AS-425) has a named test or a written verification note.
