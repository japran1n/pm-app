# F127: single-source permissions module

**Milestone:** M11 — Roles, permissions & project-level access
**Estimated worker time:** 45 minutes
**Depends on:** F126

## Assertion IDs covered
- AS-230: one permission helper backs both UI gating and the server-side re-check

## Draft scope
- `lib/auth/permissions.ts`: pure predicates over `{ role, projectRole, resourceOwnerId, callerId }` — `canEditTask`, `canDeleteTask`, `canManageMembers`, `canManageProject`, `canManageColumns`, `canViewAudit`, `canPurge`, etc.
- No I/O in the module: callers pass the membership context they already loaded.
- Exhaustive unit-test matrix: every role × every predicate, asserted explicitly rather than looped.

## Files (approximate)
lib/auth/permissions.ts (new), lib/auth/require-membership.ts, tests/unit/permissions.test.ts (new)

## Notes for clarification
- Predicate names are the vocabulary the rest of the mission uses — settle them here; renaming later touches every feature.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: logic). Full rationale: `missions/20260818-213033/clarifications/F127-clarification.md`._

- a pure, side-effect-free module under lib/ with an explicit exported API, unit-tested independently of React and Supabase.
- Validation: unit tests per assertion, including the boundary cases the feature spec names (DST, month-end, concurrency, actor exclusion, overflow).
- Access control: no — it is pure; permission checks stay in the action layer that calls it, so both cannot drift.
- Failure handling: invalid input returns a typed error or null rather than throwing, and the caller decides how to surface it.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Predicate names are the vocabulary the rest of the mission uses — settle them here; renaming later touches every feature.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-230) has a named test or a written verification note.
