# F160: multi-assignee actions

**Milestone:** M13 — Task identity, structure & relations
**Estimated worker time:** 45 minutes
**Depends on:** F159

## Assertion IDs covered
- AS-289: an assignee can be removed without affecting the others
- AS-290: only members with access to the task's project can be assigned

## Draft scope
- Rewrite `assignTask` into add/remove/set actions over `task_assignees`, Zod-validated, permission-checked, and writing both the new table and the deprecated column (single-assignee mirror) during the transition.
- Assignability check runs against project visibility (F132), rejecting guests without project access.
- Integration tests for add, remove, and the rejection path.

## Files (approximate)
lib/actions/tasks.ts, lib/validation/tasks.ts, lib/queries/members.ts

## Notes for clarification
- Decide the deprecated-column mirror rule: first assignee, or null when there are several. Notifications (F207) must not double-fire because of it.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F160-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Decide the deprecated-column mirror rule: first assignee, or null when there are several. Notifications (F207) must not double-fire because of it.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-289, AS-290) has a named test or a written verification note.
