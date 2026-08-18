# F233: calendar interactions

**Milestone:** M16 — Views
**Estimated worker time:** 30 minutes
**Depends on:** F232

## Assertion IDs covered
- AS-444: clicking a task opens its detail view
- AS-446: tasks without a due date are absent, and that absence is explained
- AS-447: a day with overflow reveals the rest

## Draft scope
- Task chips open the deep-linked task route (F246).
- A footer or side note shows the count of undated tasks with a link to the list view filtered to them.
- "+3 more" control opening a popover listing the day's remaining tasks.

## Files (approximate)
components/calendar/day-cell.tsx, components/calendar/day-overflow.tsx (new), app/(workspace)/w/[workspaceSlug]/calendar/page.tsx

## Notes for clarification
- The overflow popover must be keyboard reachable, not hover-only.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F233-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The overflow popover must be keyboard reachable, not hover-only.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-444, AS-446, AS-447) has a named test or a written verification note.
