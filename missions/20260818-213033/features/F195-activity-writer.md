# F195: record activity on every task mutation

**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Estimated worker time:** 45 minutes
**Depends on:** F194

## Assertion IDs covered
- AS-354: entries record who and when
- AS-355: status, assignee, priority, due date, estimate, and title changes record old and new values
- AS-356: comment additions and deletions appear in the same feed
- AS-360: recurrence-job changes are attributed to the system

## Draft scope
- `lib/activity/task-activity.ts` diffing the before/after task row and writing one entry per changed field, called from every task mutation including bulk actions.
- Comment add/delete write their own entry kinds.
- System-generated changes pass a null actor and render as "System".

## Files (approximate)
lib/activity/task-activity.ts (new), lib/actions/tasks.ts, lib/actions/comments.ts, supabase/migrations/ (recurrence function writes activity too)

## Notes for clarification
- Bulk updates must not write 200 near-identical rows per task — decide whether they collapse into one entry per task (yes) or one per batch (no).
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: logic). Full rationale: `missions/20260818-213033/clarifications/F195-clarification.md`._

- a pure, side-effect-free module under lib/ with an explicit exported API, unit-tested independently of React and Supabase.
- Validation: unit tests per assertion, including the boundary cases the feature spec names (DST, month-end, concurrency, actor exclusion, overflow).
- Access control: no — it is pure; permission checks stay in the action layer that calls it, so both cannot drift.
- Failure handling: invalid input returns a typed error or null rather than throwing, and the caller decides how to surface it.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Bulk updates must not write 200 near-identical rows per task — decide whether they collapse into one entry per task (yes) or one per batch (no).

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-354, AS-355, AS-356, AS-360) has a named test or a written verification note.
