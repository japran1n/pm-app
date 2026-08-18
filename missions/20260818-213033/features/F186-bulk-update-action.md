# F186: bulk field updates

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 45 minutes
**Depends on:** F185

## Assertion IDs covered
- AS-337: status change in one action
- AS-338: assignee, priority, or due date set in one action
- AS-341: a forbidden bulk action is rejected server-side for every task

## Draft scope
- One `bulkUpdateTasks` action taking an id list plus a partial patch, Zod-validated, with a per-task permission check server-side and a cap on list length.
- Executed as a single statement where possible; blocked-task confirmation (F158) is resolved before the call, not per row.
- Integration test mixing permitted and forbidden tasks in one call.

## Files (approximate)
lib/actions/tasks.ts, lib/validation/tasks.ts, components/task/bulk-action-bar.tsx

## Notes for clarification
- Decide the cap (e.g. 200 ids) and what the UI does past it.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F186-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Decide the cap (e.g. 200 ids) and what the UI does past it.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-337, AS-338, AS-341) has a named test or a written verification note.
