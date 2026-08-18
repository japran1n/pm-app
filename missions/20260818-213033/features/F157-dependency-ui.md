# F157: dependency UI

**Milestone:** M13 — Task identity, structure & relations
**Estimated worker time:** 45 minutes
**Depends on:** F156

## Assertion IDs covered
- AS-277: both sides show their relations
- AS-282: either side can remove the dependency
- AS-283: a blocked card shows an icon-plus-text indicator

## Draft scope
- "Blocked by" and "Blocks" sections in the task detail sheet, with a task picker searching by key or title within the project's workspace.
- Each row links to the related task and offers removal, gated by F127.
- Card indicator matching the overdue-indicator pattern from mission 1.

## Files (approximate)
components/task/dependencies.tsx (new), components/task/task-detail-sheet.tsx, components/task/task-card.tsx

## Notes for clarification
- The picker should exclude tasks that would create a cycle rather than letting the user pick and then fail.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F157-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The picker should exclude tasks that would create a cycle rather than letting the user pick and then fail.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-277, AS-282, AS-283) has a named test or a written verification note.
