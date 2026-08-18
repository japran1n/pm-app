# F168: project-level estimate totals

**Milestone:** M13 — Task identity, structure & relations
**Estimated worker time:** 30 minutes
**Depends on:** F167

## Assertion IDs covered
- AS-303: the project header shows summed estimates against summed logged time
- AS-304: totals exclude soft-deleted tasks

## Draft scope
- Extend the existing `rpc_project_time_totals` (mission 1) to also return the estimate sum, filtered on `deleted_at is null` and non-archived projects.
- Render alongside the existing billable/non-billable totals in the project header.
- Integration test: soft-delete a task and assert the totals drop accordingly.

## Files (approximate)
supabase/migrations/ (RPC update), lib/queries/time-entries.ts, app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx

## Notes for clarification
- Extend the existing RPC rather than adding a second one that scans the same rows.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F168-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Extend the existing RPC rather than adding a second one that scans the same rows.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-303, AS-304) has a named test or a written verification note.
