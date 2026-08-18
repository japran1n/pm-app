# F234: drag a task to another day

**Milestone:** M16 — Views
**Estimated worker time:** 45 minutes
**Depends on:** F233

## Assertion IDs covered
- AS-445: dragging a task to a different day changes its due date

## Draft scope
- `@dnd-kit` drop targets per day cell, writing the new due date through the existing task update action with optimistic UI and rollback.
- Keyboard alternative: focus a chip and use a date shortcut, so the feature is not mouse-only (AS-523).
- Dragging is disabled for users without edit rights.

## Files (approximate)
components/calendar/month-grid.tsx, components/calendar/day-cell.tsx, lib/actions/tasks.ts

## Notes for clarification
- Due date is a date, not a timestamp — the write must not shift by a timezone offset.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: logic). Full rationale: `missions/20260818-213033/clarifications/F234-clarification.md`._

- a pure, side-effect-free module under lib/ with an explicit exported API, unit-tested independently of React and Supabase.
- Validation: unit tests per assertion, including the boundary cases the feature spec names (DST, month-end, concurrency, actor exclusion, overflow).
- Access control: no — it is pure; permission checks stay in the action layer that calls it, so both cannot drift.
- Failure handling: invalid input returns a typed error or null rather than throwing, and the caller decides how to surface it.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Due date is a date, not a timestamp — the write must not shift by a timezone offset.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-445) has a named test or a written verification note.
