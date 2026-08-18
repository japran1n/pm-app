# F221: board renders project-defined columns

**Milestone:** M16 — Views
**Estimated worker time:** 45 minutes
**Depends on:** F218

## Assertion IDs covered
- AS-409: dragging a task to a column sets that status
- AS-413: column changes appear live for other viewers
- AS-416: column order persists across reloads for everyone

## Draft scope
- Board reads columns from `project_statuses` ordered by position instead of the hard-coded four; drag handlers write `status_id`.
- Add `project_statuses` to the realtime publication and reconcile column changes into the open board.
- Keep the mission-1 optimistic UI, rollback, and ordering guards intact.

## Files (approximate)
components/board/board.tsx, components/board/board-column.tsx, lib/actions/tasks.ts, lib/board/reconcile-realtime-task.ts, supabase/migrations/ (publication)

## Notes for clarification
- The cross-column drag action currently writes `status` + `position` atomically — it must now write `status_id` without losing that atomicity.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F221-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The cross-column drag action currently writes `status` + `position` atomically — it must now write `status_id` without losing that atomicity.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-409, AS-413, AS-416) has a named test or a written verification note.
