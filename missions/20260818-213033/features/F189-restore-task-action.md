# F189: restore a task from trash

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 45 minutes
**Depends on:** F188

## Assertion IDs covered
- AS-344: a restored task returns to its original project and status
- AS-351: restoring into an archived project does not unarchive the project

## Draft scope
- Restore action clearing `deleted_at`/`deleted_by`, recomputing a valid board position (the old one may now collide), and reversing the F149 parent cascade precisely.
- If the task's status no longer exists (columns changed), fall back to the project's first not-started column and say so.
- Integration tests for all three edge cases.

## Files (approximate)
lib/actions/tasks.ts, lib/board/position.ts, app/(workspace)/w/[workspaceSlug]/trash/page.tsx

## Notes for clarification
- Restoring is where stale state bites — position, status, parent, and assignees can all have moved on.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F189-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Restoring is where stale state bites — position, status, parent, and assignees can all have moved on.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-344, AS-351) has a named test or a written verification note.
