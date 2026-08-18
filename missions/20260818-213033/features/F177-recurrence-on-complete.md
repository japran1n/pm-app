# F177: generate the next occurrence on completion

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 45 minutes
**Depends on:** F176

## Assertion IDs covered
- AS-315: completing a recurring task creates the next occurrence with the due date advanced
- AS-320: completing twice does not create two occurrences
- AS-321: a recurring task in an archived project generates nothing

## Draft scope
- Hook into the status-change path: when a recurring task enters a done-category status, create the next occurrence in one transaction with the status write.
- Idempotency via `last_occurrence_at` / a unique constraint on `(recurrence_parent_id, due_date)`, so a double submit or a realtime replay cannot duplicate.
- Integration tests: complete, re-complete, complete inside an archived project.

## Files (approximate)
supabase/migrations/ (RPC), lib/actions/tasks.ts, tests/integration/recurrence.test.ts (new)

## Notes for clarification
- Idempotency must be enforced by a database constraint, not only by an application check.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F177-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Idempotency must be enforced by a database constraint, not only by an application check.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-315, AS-320, AS-321) has a named test or a written verification note.
