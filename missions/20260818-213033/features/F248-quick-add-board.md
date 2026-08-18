# F248: quick add on board columns

**Milestone:** M17 — UX polish
**Estimated worker time:** 45 minutes
**Depends on:** F221

## Assertion IDs covered
- AS-479: each column has a single-input quick add
- AS-480: focus stays in the input so several tasks can be added in a row
- AS-482: an empty submit does nothing and shows no error
- AS-483: Escape cancels without creating

## Draft scope
- "+ Add task" control at each column's foot expanding into a title input; Enter creates and clears, keeping focus.
- Created task lands at the column's end with a fractional position and the column's status.
- Hidden entirely for users without create rights.

## Files (approximate)
components/board/quick-add.tsx (new), components/board/board-column.tsx, lib/actions/tasks.ts

## Notes for clarification
- Trimmed-whitespace-only input counts as empty.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F248-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Trimmed-whitespace-only input counts as empty.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-479, AS-480, AS-482, AS-483) has a named test or a written verification note.
