# F154: task completion percentage

**Milestone:** M13 — Task identity, structure & relations
**Estimated worker time:** 30 minutes
**Depends on:** F150, F153

## Assertion IDs covered
- AS-272: completion % derives from checklist items and child tasks and shows on the card
- AS-273: a task with neither shows no percentage at all

## Draft scope
- `lib/tasks/completion.ts`: pure function over `{ checklistTotal, checklistDone, childTotal, childDone }` returning `null` when there is nothing to measure.
- Counts fetched in the existing board/list task query — no per-card round trip.
- Small progress ring or bar on the card, with the numeric value as text for AS-525.

## Files (approximate)
lib/tasks/completion.ts (new), lib/queries/tasks.ts, components/task/task-card.tsx, components/task/task-list-table.tsx

## Notes for clarification
- Weighting: are child tasks and checklist items equal units? Simplest defensible rule is a flat count of both.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: logic). Full rationale: `missions/20260818-213033/clarifications/F154-clarification.md`._

- a pure, side-effect-free module under lib/ with an explicit exported API, unit-tested independently of React and Supabase.
- Validation: unit tests per assertion, including the boundary cases the feature spec names (DST, month-end, concurrency, actor exclusion, overflow).
- Access control: no — it is pure; permission checks stay in the action layer that calls it, so both cannot drift.
- Failure handling: invalid input returns a typed error or null rather than throwing, and the caller decides how to surface it.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Weighting: are child tasks and checklist items equal units? Simplest defensible rule is a flat count of both.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-272, AS-273) has a named test or a written verification note.
