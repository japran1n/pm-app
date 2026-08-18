# F143: restore an archived project

**Milestone:** M12 — Workspace admin, audit log & archive
**Estimated worker time:** 30 minutes
**Depends on:** F142

## Assertion IDs covered
- AS-252: a restored project reappears with its tasks intact
- AS-253: restore is rejected without admin rights
- AS-255: a restored project's tasks reappear in search and dashboard counts

## Draft scope
- Restore action clearing the archive fields, gated by F127, writing an audit entry.
- Revalidate the project list, dashboard, and search paths so counts update immediately.
- Integration test: archive → restore → task count and search hits match the pre-archive state.

## Files (approximate)
lib/actions/projects.ts, app/(workspace)/w/[workspaceSlug]/archive/page.tsx, components/project/restore-project-button.tsx (new)

## Notes for clarification
- Restoring must not resurrect tasks that were independently soft-deleted before archiving.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F143-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Restoring must not resurrect tasks that were independently soft-deleted before archiving.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-252, AS-253, AS-255) has a named test or a written verification note.
