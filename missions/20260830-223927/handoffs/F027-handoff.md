# Handoff: F027 — Add realtime wiring tests (calendar)

## Status
COMPLETE

## Assertions covered
AS-019: PASS — `test_AS_019_UPDATE_changing_due_date_moves_the_task_to_the_new_day` renders `CalendarDayGrid`, fires a fake UPDATE payload through the mocked Supabase channel, asserts the task text moves from the old day cell to the new one.
AS-020: PASS — `test_AS_020_INSERT_with_due_date_shows_the_new_task_on_the_correct_day` fires a fake INSERT payload, asserts the new task title appears in the correct day cell.
AS-021: PASS — `test_AS_021_UPDATE_clearing_due_date_removes_the_task_from_the_grid` and `test_AS_021_DELETE_removes_the_task_from_the_grid` fire UPDATE-with-null-due_date and DELETE payloads respectively, assert the task text disappears from the document.
AS-022: PASS — `test_AS_022_subscribes_on_the_workspace_scoped_calendar_channel` asserts the component subscribes on the exact `tasks:calendar:<workspaceId>` topic (the project-visibility backstop's channel scope), reusing the existing pure-reconciler coverage of the actual filtering logic from F009.

## Files changed
tests/unit/f027-calendar-realtime-wiring.test.tsx (new)

## Commands run
`npx vitest run tests/unit/f027-calendar-realtime-wiring.test.tsx` (0, 5/5 pass)
`npx tsc --noEmit` (0)
`npx eslint tests/unit/f027-calendar-realtime-wiring.test.tsx` (0)
`npm test` (full suite; 5 pre-existing, unrelated integration failures — see Notes)
Manual regression check: temporarily deleted the `useCalendarRealtime({...})` call from `components/calendar/calendar-day-grid.tsx`, reran the new test file — all 5 tests failed (confirming the wiring gap is now covered), then restored the file (`git diff` on it is clean).

## Decisions made
- Followed the existing `tests/unit/f251-list-table-realtime.test.tsx` pattern: mock `@/lib/supabase/client`'s `createClient` with a fake channel object whose `.on()` records the dispatch callback, then call that callback directly inside `act()` to simulate a live Realtime event, and assert on rendered DOM via Testing Library rather than inspecting internal state.
- Each test uses a unique `workspaceId` (`workspace-${counter}`) rather than a shared one. `subscribeToCalendarRealtime` goes through `lib/realtime/shared-topic-channel.ts`'s ref-counted registry (F329), which dedupes `.channel()`/`.on()` per topic and tears the channel down asynchronously (`setTimeout`) on unmount. Reusing the same workspaceId across tests in one file caused later tests' `.on()` never to be called (the earlier test's still-live entry was silently reused), so `onCalls` stayed empty — a unique topic per test sidesteps that registry entirely and gives each test its own real channel/`.on()` registration.
- Mocked `@/lib/actions/tasks` (`editTask`) and `@/components/auth/membership-provider` (`useMembership` → `null`, same permissive default the component itself falls back to) purely to keep the render isolated — no assertions target drag/drop or membership in this file, that's already F234's own test surface.
- Did not touch `components/calendar/calendar-day-grid.tsx`, `use-calendar-realtime.ts`, or `reconcile-realtime-task.ts` — spec is test-only.

## Out-of-scope work needed
None identified for this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used unique `workspaceId` values per test (rather than one shared workspace across the whole file) to avoid the shared-topic-channel registry silently short-circuiting `.on()` calls on later tests. This wasn't specified in the clarified spec but is the only way to get deterministic per-test channel wiring given F329's existing ref-counted dedup behavior.

## Notes for the next worker
- `npm test` (full suite) has 5 pre-existing failures unrelated to this change, all integration tests hitting a live Supabase instance whose schema cache is missing several `*_atomic` RPC functions (`duplicate_task_atomic`, `bulk_delete_tasks_atomic`, `restore_task_atomic`, `set_task_assignees_atomic`) — `PGRST202: Could not find the function ... in the schema cache`. These live in `tests/integration/bulk-restore-tasks.test.ts` and `tests/integration/f306-mutation-fanout.test.ts`, files this feature does not touch. This looks like a migration/schema-cache environment gap (the DB functions may exist in migrations but haven't been applied/refreshed against the live test project), not something introduced by this test-only feature. Confirmed by running only the new F027 test file in isolation (5/5 pass) and by checking `git diff` on `calendar-day-grid.tsx` is empty (no product code was modified).
- Regression proof: deleting the `useCalendarRealtime({...})` call from `calendar-day-grid.tsx` makes all 5 new tests fail, satisfying the mission's explicit requirement that this gap actually be caught.
