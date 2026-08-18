# F212: overdue notifications

**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Estimated worker time:** 45 minutes
**Depends on:** F207, F124

## Assertion IDs covered
- AS-383: an assignee is notified when their task becomes overdue

## Draft scope
- Scheduled SQL function (pg_cron) sweeping tasks whose due date has passed in the assignee's timezone and which have no open overdue notification yet.
- Idempotency: one overdue notification per task per assignee, tracked by a marker column or a unique partial index.
- Skips archived projects, trashed tasks, and done-category statuses.

## Files (approximate)
supabase/migrations/ (function + cron.schedule)

## Notes for clarification
- Timezone handling in SQL is the tricky part — the sweep runs hourly and compares against each user's zone rather than a single daily UTC pass.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: logic). Full rationale: `missions/20260818-213033/clarifications/F212-clarification.md`._

- a pure, side-effect-free module under lib/ with an explicit exported API, unit-tested independently of React and Supabase.
- Validation: unit tests per assertion, including the boundary cases the feature spec names (DST, month-end, concurrency, actor exclusion, overflow).
- Access control: no — it is pure; permission checks stay in the action layer that calls it, so both cannot drift.
- Failure handling: invalid input returns a typed error or null rather than throwing, and the caller decides how to surface it.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Timezone handling in SQL is the tricky part — the sweep runs hourly and compares against each user's zone rather than a single daily UTC pass.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-383) has a named test or a written verification note.
