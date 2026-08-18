# F191: restore a deleted comment

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 30 minutes
**Depends on:** F188

## Assertion IDs covered
- AS-346: a deleted comment can be restored by its author or an admin

## Draft scope
- Restore action for comments, permission-checked via F127 (author or admin only).
- The restored comment reappears live for other viewers, respecting the mission-1 realtime/RLS soft-delete gotcha.
- Integration test: delete, restore, and assert the realtime payload reaches a second client.

## Files (approximate)
lib/actions/comments.ts, lib/tasks/reconcile-realtime-comment.ts, app/(workspace)/w/[workspaceSlug]/trash/page.tsx

## Notes for clarification
- Mission 1's F104 fixed exactly this delivery path for deletes; restores go through the same trap.
- MCP at run: Supabase MCP for policy verification.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F191-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Mission 1's F104 fixed exactly this delivery path for deletes; restores go through the same trap.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-346) has a named test or a written verification note.
