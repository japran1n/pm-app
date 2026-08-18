# F124: timezone-aware date utilities

**Milestone:** M10 — Foundation v2 & identity primitives
**Estimated worker time:** 45 minutes
**Depends on:** F120

## Assertion IDs covered
- AS-207: due-date and overdue calculations use the user's timezone, not the server's

## Draft scope
- `lib/time/user-timezone.ts`: start-of-day / end-of-day / is-today / is-overdue computed against a passed-in IANA timezone, built on `date-fns` (plus `Intl` for zone maths — no new dependency).
- Rework `lib/tasks/is-overdue.ts` to take a timezone argument; update every call site (board card, list, dashboard overdue tile).
- Unit tests covering a user east and west of UTC around midnight, and a DST boundary.

## Files (approximate)
lib/time/user-timezone.ts (new), lib/tasks/is-overdue.ts, components/task/task-card.tsx, components/dashboard/overdue-tile.tsx

## Notes for clarification
- Server Components must read the caller's timezone once per request and thread it down, not call the DB per card.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: logic). Full rationale: `missions/20260818-213033/clarifications/F124-clarification.md`._

- a pure, side-effect-free module under lib/ with an explicit exported API, unit-tested independently of React and Supabase.
- Validation: unit tests per assertion, including the boundary cases the feature spec names (DST, month-end, concurrency, actor exclusion, overflow).
- Access control: no — it is pure; permission checks stay in the action layer that calls it, so both cannot drift.
- Failure handling: invalid input returns a typed error or null rather than throwing, and the caller decides how to surface it.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Server Components must read the caller's timezone once per request and thread it down, not call the DB per card.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-207) has a named test or a written verification note.
