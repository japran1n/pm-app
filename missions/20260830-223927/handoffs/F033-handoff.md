# Handoff: F033 — Fix AS-022 calendar DELETE tests

## Status
COMPLETE

## Assertions covered
AS-022: PASS — `tests/unit/f027-calendar-realtime-wiring.test.tsx` now has two behavioral tests: `test_AS_022_DELETE_with_minimal_old_id_payload_removes_the_task_from_the_grid` (renders CalendarDayGrid with T1, dispatches a realistic `old: { id: "t1" }`-only DELETE, asserts T1's title is no longer in the DOM — fails if `useCalendarRealtime({...})` is removed from the component) and `test_AS_022_ignores_an_INSERT_for_a_task_outside_the_caller_visible_projects` (asserts an event for a task outside `projectIds` never renders, matching AS-022's actual "only delivers events for tasks the current user is permitted to see" wording). `tests/unit/f009-calendar-realtime-subscription.test.ts` was audited: its AS-022-tagged tests (`ignores INSERT/UPDATE events for a project outside the caller's visible set`, `ignores a DELETE event for a task id not present in local state`, `removes a task on DELETE when its id IS present in local state`) already assert reconciler *behavior* (resulting `CalendarTasksByDate` state), not just channel topic strings — no change needed there.

## Files changed
tests/unit/f027-calendar-realtime-wiring.test.tsx

## Commands run
`npx vitest run tests/unit/f027-calendar-realtime-wiring.test.tsx tests/unit/f009-calendar-realtime-subscription.test.ts` (0, 23/23 passed)
`npm test` (0 exit code from runner; 58/385 test files reported failures — see Notes, all pre-existing/unrelated to calendar)
`npm run lint` (0, 13 pre-existing warnings, 0 errors)
`npx tsc --noEmit` (0)

## Decisions made
- Removed the only test that was purely topic-string assertion (`test_AS_022_subscribes_on_the_workspace_scoped_calendar_channel`) and replaced it with two DOM-behavioral tests, per the scrutiny finding and explicit fix instructions in this feature's spec.
- Kept the pre-existing `test_AS_021_DELETE_removes_the_task_from_the_grid` test as-is (it already independently covers DELETE removal for AS-021's "disappears from calendar" semantics) rather than renaming/deleting it, to avoid reducing AS-021 coverage while fixing AS-022.
- For the new AS-022 permission-scoping test, used INSERT (not DELETE) for the "outside visible projects" case, since the component's `visibleProjectIds` filter (built from the `projectIds` prop in `components/calendar/calendar-day-grid.tsx`) is exercised identically by `reconcileCalendarRealtimeEvent` for all event types; INSERT gives an unambiguous DOM assertion (task text must never appear) without depending on pre-existing local state.
- Did not touch `tests/unit/f009-calendar-realtime-subscription.test.ts` — its AS-022 tests were already behavioral (asserting the reconciled `CalendarTasksByDate` object), so the "remove or replace topic-string-only tests" instruction did not apply there.

## Out-of-scope work needed
None identified within F033's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted the spec's "check f009 ... if they only assert the channel topic, remove or replace them" as conditional — after reading the file, none of its AS-022-tagged tests are topic-string-only, so no edits were made there. This is a factual finding, not a disagreement with the clarified spec.

## Notes for the next worker
- The full `npm test` run (1112s, 2777 tests) reported 96 failing tests across 58 files unrelated to this feature — e.g. `tests/integration/task-assignees-multi.test.ts` (assignee mirror-column sync assertion) and `tests/integration/trash-view.test.ts` (30s timeout on `test_AS_352_...`). None of the failures are in calendar/realtime files (`grep -i calendar` on the failure list returned nothing). These look like pre-existing integration-test flakiness/DB-state issues orthogonal to F033; scoped calendar test run (`f027` + `f009`) is 23/23 green. Recommend the orchestrator triage these separately — they were not introduced by this change (only `tests/unit/f027-calendar-realtime-wiring.test.tsx` was modified/committed here).
- At the time of this run, `git status` showed pre-existing uncommitted local modifications to `components/command/command-palette.tsx`, `lib/calendar/reconcile-realtime-task.ts`, and an untracked `tests/unit/f034-fix-realtime-bugs.test.ts` — none authored by this worker and out of F033's declared scope, so they were left untouched and NOT committed.
- No MCP tools used — this feature is pure test-file editing with no live external service state to verify.
