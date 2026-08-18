# F207: notification fan-out

**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Estimated worker time:** 45 minutes
**Depends on:** F206, F205, F164

## Assertion IDs covered
- AS-294: watchers are notified of a task's activity
- AS-374: a mention notifies with a link to the comment
- AS-375: a mentioned non-watcher becomes a watcher
- AS-380: assignment notifies the assignee
- AS-381: a mention notifies the mentioned user
- AS-382: watchers are notified of status changes and comments
- AS-384: no one is notified of their own actions

## Draft scope
- `lib/notifications/fanout.ts`: given an event (assigned, mentioned, commented, status_changed), compute recipients (assignees ∪ watchers ∪ mentioned) minus the actor, de-duplicated, and insert one row each through the security-definer function.
- Respects per-user preferences from F211 once it lands; until then, all in-app notifications are on.
- Unit tests for recipient computation, including the actor-exclusion and dedupe cases.

## Files (approximate)
lib/notifications/fanout.ts (new), lib/actions/tasks.ts, lib/actions/comments.ts

## Notes for clarification
- One event must produce at most one notification per recipient even when they are assignee, watcher, and mentioned at once.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: logic). Full rationale: `missions/20260818-213033/clarifications/F207-clarification.md`._

- a pure, side-effect-free module under lib/ with an explicit exported API, unit-tested independently of React and Supabase.
- Validation: unit tests per assertion, including the boundary cases the feature spec names (DST, month-end, concurrency, actor exclusion, overflow).
- Access control: no — it is pure; permission checks stay in the action layer that calls it, so both cannot drift.
- Failure handling: invalid input returns a typed error or null rather than throwing, and the caller decides how to surface it.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - One event must produce at most one notification per recipient even when they are assignee, watcher, and mentioned at once.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-294, AS-374, AS-375, AS-380, AS-381, AS-382, AS-384) has a named test or a written verification note.
