# F130: transfer workspace ownership

**Milestone:** M11 — Roles, permissions & project-level access
**Estimated worker time:** 30 minutes
**Depends on:** F129

## Assertion IDs covered
- AS-233: an owner can transfer ownership; the previous owner becomes an admin
- AS-234: transfer to a non-active member is rejected

## Draft scope
- Server Action doing both role writes in one atomic database function, so the workspace is never ownerless or double-owned mid-transfer (same pattern as the mission-1 sole-owner RPC).
- Confirmation dialog naming the new owner and stating the caller's own demotion.
- Integration test for the atomicity: a failure mid-transfer leaves the original owner intact.

## Files (approximate)
supabase/migrations/ (new RPC), lib/actions/workspaces.ts, components/transfer-ownership-dialog.tsx (new)

## Notes for clarification
- Reuse the mission-1 `remove_member_atomic_owner_guard` RPC shape rather than inventing a second locking approach.
- MCP at run: Supabase MCP for the RPC.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F130-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Reuse the mission-1 `remove_member_atomic_owner_guard` RPC shape rather than inventing a second locking approach.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-233, AS-234) has a named test or a written verification note.
