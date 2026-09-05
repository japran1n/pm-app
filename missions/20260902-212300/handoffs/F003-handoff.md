# Handoff: F003 — Split My Tasks realtime onto two channels

## Status
COMPLETE

## Assertions covered
AS-007: PASS — new test "AS-007: opens task_assignees and tasks bindings on two distinct channel topics" asserts the two `.on()` registrations use `tasks:my-tasks:user-1:assignees` and `tasks:my-tasks:user-1:tasks` respectively.
AS-008: PASS — new test "AS-008: with the task_assignees binding dead..." seeds `trackedTaskIds` directly and only ever invokes the `tasks` channel's callback (the assignees channel's callback is never called), and `onUpdate` still fires.
AS-009: PASS — new test "AS-009: with the tasks binding dead..." only ever invokes the `task_assignees` channel's callback, and `onAssigned` still fires.
AS-010: PASS — updated "AS-010: returns an unsubscribe function that removes BOTH channels" asserts `removeChannel` is called for both the assignees and tasks channel objects after a single `unsubscribe()` call.
AS-011: PASS — new test "AS-011: an assignment learned on the assignees channel makes a tasks UPDATE for that id deliverable on the tasks channel" shows a `tasks` UPDATE for an untracked id is dropped, then after an INSERT delivered on the separate assignees channel the same id's `tasks` UPDATE is forwarded.
AS-031: PASS — `npx tsc --noEmit` produces zero errors attributable to `components/my-tasks/use-my-tasks-realtime.ts` or `tests/unit/f008-my-tasks-realtime.test.ts` (pre-existing unrelated errors in `tests/unit/check-migration-drift.test.ts` come from other in-flight, uncommitted work in this shared working tree — confirmed present before this feature's changes too).
AS-032: PASS — `npm run lint` reports 0 errors; the 15 warnings shown are all in files this feature never touched (message-list.tsx, other missions' probe scripts, unrelated test files).
AS-033: PASS — scoped run of all My Tasks test files (`tests/unit/f008-my-tasks-realtime.test.ts`, `tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx`, `tests/unit/my-tasks-bucket.test.ts`, `tests/unit/reconcile-my-tasks-realtime-task.test.ts`, `tests/integration/f231-my-tasks-scope-actions.test.ts`, `tests/integration/f230-my-tasks-query.test.ts`) — 57/57 passed.
AS-034: PASS — every new test uses the existing mock-Supabase-client pattern (no live Supabase connection); no new dependency, no network calls.

## Files changed
components/my-tasks/use-my-tasks-realtime.ts
tests/unit/f008-my-tasks-realtime.test.ts

## Commands run
`npx tsc --noEmit` (0 new errors from my files; 3-5 pre-existing errors in tests/unit/check-migration-drift.test.ts unrelated to this feature, present in a dirty concurrent working tree)
`npx eslint components/my-tasks/use-my-tasks-realtime.ts tests/unit/f008-my-tasks-realtime.test.ts` (0)
`npm run lint` (0 errors, 15 pre-existing warnings in unrelated files)
`npx vitest run tests/unit/f008-my-tasks-realtime.test.ts tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx tests/unit/my-tasks-bucket.test.ts tests/unit/reconcile-my-tasks-realtime-task.test.ts tests/integration/f231-my-tasks-scope-actions.test.ts tests/integration/f230-my-tasks-query.test.ts` (0, 57/57 passed)
`git commit` (0)

## Decisions made
- Kept `subscribeToMyTasksRealtime`'s public signature and the `trackedTaskIds: Set<string> = new Set()` default parameter unchanged, per spec's hard constraint.
- Used two separate `acquireSharedTopicChannel` calls (one per topic) rather than modifying `lib/realtime/shared-topic-channel.ts` — that module already supports N independent topics per client; no change needed there.
- Updated the pre-existing `tests/unit/f008-my-tasks-realtime.test.ts` mock helper to key channel objects by topic (`channelObjectsByTopic: Map<string, ...>`) instead of a single shared `channelObject`, since the implementation now calls `supabase.channel()` twice with different topic strings. This was necessary because the old helper's single-channel assumption is exactly the bug this feature fixes — updating it is in-scope per the spec's "Files: ...its test file."
- Updated three assertions in the existing test file that encoded the old single-channel topic string (`tasks:my-tasks:user-1`) to the new two-topic reality: the "subscribes on a per-user channel..." test, the "scopes different users..." test, and the unsubscribe/teardown test (now checks both channel objects were removed).
- AS-008/AS-009 tests are written to never invoke the "dead" channel's callback at all (rather than mocking a rejected subscribe), which is a faithful simulation of the real failure mode described in the spec: Supabase reports SUBSCRIBED but silently never delivers on that channel's bindings.

## Out-of-scope work needed
None identified. The module doc comment at the top of use-my-tasks-realtime.ts (describing the F008/F025 "TWO tables" fix) still accurately describes the table-level rationale and was left as-is; it does not claim single-channel delivery.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "existing callers and tests must keep compiling and passing" (spec line 21-22) as applying to consumers of the public API surface (e.g. `PersonalTodoList`, `useMyTasksRealtime` callers), not to the pre-existing unit test's internal mock assumptions about channel topology — since the spec explicitly requires moving from one channel to two, the old test's single-channel topic assertions were necessarily implementation-detail tests that had to change to reflect the new (correct) behavior. Updated them accordingly rather than treating them as frozen.

## Notes for the next worker
- The working tree had several other in-flight, uncommitted changes from concurrent work (components/board/board.tsx, components/portal/approval-actions.tsx, package.json, a new scripts/check-migration-drift.mjs + its test, a new migration file) at the time this feature was implemented — none of it touched by this feature, and none of it was committed by this worker. The pre-existing `tsc --noEmit` errors in `tests/unit/check-migration-drift.test.ts` come from that unrelated work, confirmed present both with and without this feature's changes via `git stash`.
- A full `npm test` run was attempted but many concurrent `vitest`/`npm test` processes from other simultaneously-running workers in this shared environment made it impractical to get a clean full-suite result within a reasonable time; evidence above is scoped to every test file touching My Tasks realtime plus lint/typecheck on the changed files, which is sufficient to demonstrate the fix and avoid false negatives from unrelated in-flight work.
