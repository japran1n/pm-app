# F150: subtasks in the task detail view

**Milestone:** M13 — Task identity, structure & relations
**Estimated worker time:** 45 minutes
**Depends on:** F149

## Assertion IDs covered
- AS-263: a child links back to its parent
- AS-264: a parent lists its children with status and a completion count
- AS-275: child tasks still appear as ordinary board cards

## Draft scope
- Subtask section in `task-detail-sheet.tsx`: inline add-subtask input, child rows with status chip and assignee avatar, "3 of 5 done" count.
- Child task header shows a breadcrumb link to its parent.
- Board card shows a small subtask indicator (icon + count), never colour alone.

## Files (approximate)
components/task/subtask-list.tsx (new), components/task/task-detail-sheet.tsx, components/task/task-card.tsx

## Notes for clarification
- Reuse the quick-add interaction pattern from F248 so adding subtasks feels the same as adding tasks.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F150-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Reuse the quick-add interaction pattern from F248 so adding subtasks feels the same as adding tasks.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-263, AS-264, AS-275) has a named test or a written verification note.
