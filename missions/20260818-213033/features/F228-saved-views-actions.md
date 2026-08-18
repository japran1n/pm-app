# F228: saved view actions

**Milestone:** M16 — Views
**Estimated worker time:** 30 minutes
**Depends on:** F227

## Assertion IDs covered
- AS-428: opening a view restores filters, sort, and grouping exactly
- AS-430: only the creator or an admin edits or deletes a shared view
- AS-431: a view can be set as the user's default for a project

## Draft scope
- Actions: create, update, delete, set-default; permission checks through F127.
- Applying a view writes its config into the URL search params so the existing filter machinery keeps being the source of truth.
- Default view resolution happens server-side on project open.

## Files (approximate)
lib/actions/views.ts (new), lib/views/apply-view.ts (new), app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx

## Notes for clarification
- URL params as the canonical state keeps sharing (AS-432) free — do not introduce a parallel client store.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F228-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - URL params as the canonical state keeps sharing (AS-432) free — do not introduce a parallel client store.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-428, AS-430, AS-431) has a named test or a written verification note.
