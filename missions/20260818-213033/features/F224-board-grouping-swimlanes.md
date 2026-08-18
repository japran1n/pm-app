# F224: swimlanes by assignee, priority, or tag

**Milestone:** M16 — Views
**Estimated worker time:** 45 minutes
**Depends on:** F221, F161

## Assertion IDs covered
- AS-418: the board can be grouped into swimlanes
- AS-419: with no grouping, the board renders as before
- AS-421: each lane shows its own per-column counts
- AS-423: tasks without a value appear in a "None" lane

## Draft scope
- Grouping control in the board toolbar; the board renders lane rows, each containing the project's columns.
- Grouping is computed client-side from the already-loaded task set to avoid N queries.
- Lane headers show the group's avatar/label plus per-column counts.

## Files (approximate)
components/board/board.tsx, components/board/swimlane.tsx (new), components/board/board-toolbar.tsx (new), lib/board/grouping.ts (new)

## Notes for clarification
- Multi-assignee tasks appear in several assignee lanes; state that rule in the UI so counts are not read as duplicates.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F224-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Multi-assignee tasks appear in several assignee lanes; state that rule in the UI so counts are not read as duplicates.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-418, AS-419, AS-421, AS-423) has a named test or a written verification note.
