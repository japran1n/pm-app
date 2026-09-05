# Handoff: F036 — Fix AS-020 isDone derivation + AS-022 test unpin

## Status
COMPLETE

## Assertions covered
AS-020: PASS — `reconcileCalendarRealtimeEvent`'s UPDATE branch now calls `isDoneStatus(row.status)` (no category arg) instead of `isDoneStatus(row.status, existing.statusCategory)`, so a task moved to a "done"-category status is no longer masked by the stale existing category. Verified via `test_AS_020_marks_isDone_true_when_an_update_moves_a_tracked_task_to_done` and `test_AS_020_marks_isDone_false_when_an_update_moves_a_tracked_done_task_back_to_todo` in `tests/unit/f034-fix-realtime-bugs.test.ts`, both updated to use a realistic non-null `statusCategory` on the existing row (`in_progress` / `done`) to reproduce the short-circuit bug.
AS-022: PASS — the f009 subscription test that pinned the absence of a delivery-scope filter (asserting `.on()`'s filter arg `toEqual({event,schema,table})` exactly) was rewritten to assert only the individual fields AS-022 actually requires (`event === "*"`, `schema === "public"`, `table === "tasks"`), so a future legitimate server-side filter addition won't break this test. Verified via `tests/unit/f009-calendar-realtime-subscription.test.ts`.

## Files changed
lib/calendar/reconcile-realtime-task.ts
tests/unit/f034-fix-realtime-bugs.test.ts
tests/unit/f009-calendar-realtime-subscription.test.ts

## Commands run
`npx vitest run tests/unit/f009-calendar-realtime-subscription.test.ts tests/unit/f034-fix-realtime-bugs.test.ts tests/unit/f027-calendar-realtime-wiring.test.tsx` (0, 28 passed)
`npx vitest run tests/unit` (0, 193 files / 1489 tests passed — full unit suite)
`npm run lint` (0, only pre-existing unrelated warnings, no errors)
`npx tsc --noEmit` (0)
`git commit` (0)

## Decisions made
- Passed no category argument to `isDoneStatus` on UPDATE rather than explicitly passing `null`, since the function treats "no second argument" and "null" identically (`category !== undefined && category !== null`) — matches the existing INSERT branch's style (`isDoneStatus(row.status)`).
- Left `existing.statusCategory` unchanged on the merged UPDATE task object (only `isDone` was mis-derived per the spec; `statusCategory` itself is a display/join field the bare `tasks` row event never carries a fresh value for, same as before this fix).
- Updated the F034 regression tests' `baseTask.statusCategory` from `null` to `"in_progress"` (and the done-task variant to `"done"`) because `statusCategory: null` never triggered the short-circuit bug in the first place — a realistic non-null category was required to actually reproduce and pin the fix, per the feature spec's explicit instruction.
- For AS-022, rewrote rather than deleted the test, keeping assertion coverage that a subscription is established, scoped per-workspace, and listens to all `tasks` events — only removed the part that pinned the specific absence of a filter key.

## Out-of-scope work needed
None identified beyond this fix's scope.

## Blockers
None.

## Autonomous decisions
None — both fixes followed the spec's explicit instructions directly.

## Notes for the next worker
- `lib/tasks/status-category.ts`'s `isDoneStatus(status, category)` short-circuits to category-only comparison whenever `category` is non-null/non-undefined, regardless of `status`. Any call site passing a cached/stale category value alongside a freshly-changed status is at risk of this same bug class — worth grepping other realtime reconcilers (e.g. `lib/tasks/reconcile-list-realtime-task.ts`, `lib/board/reconcile-realtime-task.ts`) for the same pattern if not already covered by F029/F034 fixes.
- No MCP tools were needed for this fix — pure client-side reconciliation logic and test assertions, no live schema/service state involved.
