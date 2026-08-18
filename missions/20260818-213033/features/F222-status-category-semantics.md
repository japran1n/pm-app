# F222: done-category semantics

**Milestone:** M16 — Views
**Estimated worker time:** 30 minutes
**Depends on:** F221

## Assertion IDs covered
- AS-410: a task counts as complete for progress, overdue, and dependency purposes when its column category is done

## Draft scope
- Replace every literal `status === 'done'` comparison with a category check: completion % (F154), overdue detection, dependency warnings (F158), recurrence completion (F177), digest, and dashboard.
- One shared helper (`isDoneStatus(status)`) so the rule exists once.
- Unit tests over a project with two done-category columns.

## Files (approximate)
lib/tasks/status-category.ts (new), lib/tasks/is-overdue.ts, lib/tasks/completion.ts, lib/actions/tasks.ts, lib/queries/dashboard.ts

## Notes for clarification
- Grep for the string 'done' across the repo before starting; the literal is likely in more places than expected.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: audit). Full rationale: `missions/20260818-213033/clarifications/F222-clarification.md`._

- read every file in the feature's Files scope, compare against the assigned assertions, fix in place, and list what was checked in the handoff.
- Validation: an automated test per assertion where feasible, plus a written enumeration of what was inspected for structural/negative assertions.
- Access control: only where an assigned assertion is about access; policy changes come with an RLS integration test.
- Failure handling: fix it inside this feature's file scope and record it in the handoff's Decisions Made; gaps outside scope go to Out-of-scope work needed.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Grep for the string 'done' across the repo before starting; the literal is likely in more places than expected.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-410) has a named test or a written verification note.
