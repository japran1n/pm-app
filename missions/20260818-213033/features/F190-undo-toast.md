# F190: undo after delete

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 30 minutes
**Depends on:** F189

## Assertion IDs covered
- AS-345: deleting shows an undo affordance that restores without visiting trash

## Draft scope
- Sonner toast with an Undo action after task, comment, and bulk deletes, calling the restore action with the affected ids.
- The toast survives navigation within the app for its lifetime; undoing after it expires is still possible via trash, and the toast says so.
- Bulk deletes undo the whole batch in one call.

## Files (approximate)
components/ui/sonner.tsx, lib/actions/tasks.ts, components/task/*, components/task/bulk-action-bar.tsx

## Notes for clarification
- Undo must be idempotent — double-clicking it cannot create duplicates or error loudly.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F190-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Undo must be idempotent — double-clicking it cannot create duplicates or error loudly.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-345) has a named test or a written verification note.
