# F231: My Tasks scope, actions and empty state

**Milestone:** M16 — Views
**Estimated worker time:** 30 minutes
**Depends on:** F230, F163

## Assertion IDs covered
- AS-437: excludes archived projects and trash
- AS-438: status can be changed directly from the page
- AS-440: a purposeful empty state when nothing is assigned
- AS-441: optionally includes watched tasks

## Draft scope
- Query goes through the shared archived/trashed exclusion helper (F144/F193).
- Inline status select per row reusing F250's inline-edit component.
- "Include tasks I watch" toggle persisted per user; empty state explains how tasks get assigned.

## Files (approximate)
lib/queries/my-tasks.ts, app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx, components/task/list-status-select.tsx

## Notes for clarification
- Watched tasks should be visually distinguishable from assigned ones when the toggle is on.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F231-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Watched tasks should be visually distinguishable from assigned ones when the toggle is on.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-437, AS-438, AS-440, AS-441) has a named test or a written verification note.
