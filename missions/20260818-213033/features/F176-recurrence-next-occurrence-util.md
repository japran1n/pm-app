# F176: next-occurrence maths + field copy rules

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 45 minutes
**Depends on:** F175

## Assertion IDs covered
- AS-316: the new occurrence copies title, description, assignees, priority, checklist, and estimate but not comments, attachments, or logged time

## Draft scope
- `lib/recurrence/next-date.ts`: pure function from `(rule, fromDate, timezone)` to the next due date, handling month-end (31st → shorter months) and DST, with unit tests for both.
- `lib/recurrence/clone-fields.ts`: the explicit allow-list of fields copied into an occurrence, unit-tested field by field.

## Files (approximate)
lib/recurrence/next-date.ts (new), lib/recurrence/clone-fields.ts (new), tests/unit/recurrence.test.ts (new)

## Notes for clarification
- Month-end behaviour needs a stated rule (clamp to last day vs skip); pick clamp and document it.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: logic). Full rationale: `missions/20260818-213033/clarifications/F176-clarification.md`._

- a pure, side-effect-free module under lib/ with an explicit exported API, unit-tested independently of React and Supabase.
- Validation: unit tests per assertion, including the boundary cases the feature spec names (DST, month-end, concurrency, actor exclusion, overflow).
- Access control: no — it is pure; permission checks stay in the action layer that calls it, so both cannot drift.
- Failure handling: invalid input returns a typed error or null rather than throwing, and the caller decides how to surface it.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Month-end behaviour needs a stated rule (clamp to last day vs skip); pick clamp and document it.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-316) has a named test or a written verification note.
