# Handoff: F026 — board.tsx releasePendingMove call-site coverage (fix-up, third attempt)

## Status
COMPLETE

## Assertions covered
AS-026: PASS — `board-optimistic-move-realtime-guard.test.ts` (pure `releasePendingMove` unit coverage, pre-existing) plus `tests/unit/f022-board-realtime-guard-call-site.test.tsx`'s existing AS-025 test (moveAndReorderTask release at `board.tsx:826`) and the new `test_AS_027_reorderTask_ok_false_failure_releases_the_guard_for_a_same-column_reorder` test (release at `:841`). Both mutation-verified.
AS-027: PASS — four new call-site tests in `tests/unit/f022-board-realtime-guard-call-site.test.tsx` each mount the real `<Board>`, drive a genuine drag via the captured `onDragEnd`, force the dispatched Server Action to FAIL (`{ ok: false }` or a thrown rejection), then fire a Realtime UPDATE for that task and assert it IS applied — proving the guard was released, not left stuck. Covers all four previously-surviving release sites: `reorderTask` (`:841`, `{ok:false}`), `editTask` (`:864`, rejection, groupBy="priority"), `setTaskAssignees` (`:875`, `{ok:false}`, groupBy="assignee"), `updateTaskTags` (`:886`, rejection, groupBy="tag").

## Files changed
tests/unit/f022-board-realtime-guard-call-site.test.tsx

## Commands run
`npx vitest run tests/unit/f022-board-realtime-guard-call-site.test.tsx` (0, 5/5 passed)
`npx vitest run tests/unit` (0, 206 files / 1610 tests passed)
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 15 pre-existing warnings unrelated to this change)
Mutation verification (manual, via `sed` on `components/board/board.tsx`, restored after each): deleting `releasePendingMove(movedTask.id)` at line 841 → 4 tests FAIL (shared by the reorderTask test and all three cross-lane tests, since every cross-lane scenario also fires `reorderTask` when status is unchanged). Deleting at line 864 → 1 test FAILS (editTask/priority test). Deleting at line 875 → 1 test FAILS (setTaskAssignees/assignee test). Deleting at line 886 → 1 test FAILS (updateTaskTags/tag test). Restored `board.tsx` after each mutation via `cp` from a saved original; `git diff --stat components/board/board.tsx` confirmed clean (no net change) and full suite green again after restore.

## Decisions made
- Did not touch `components/board/board.tsx` or `lib/board/pending-moves.ts` at all — the bug scrutiny-3 found was a **test coverage gap**, not an implementation defect (all five release sites were already correctly wired with `.finally(() => releasePendingMove(...))`). Confirmed this by mutation-testing each site: deletion fails a test, meaning the existing code is correct and now proven so.
- Extended the existing `tests/unit/f022-board-realtime-guard-call-site.test.tsx` file rather than creating a new one, per the instructions' explicit guidance to keep F022's real-mount, real-drag approach (round 1 rejected regex-over-source tests; F022's call-site pattern is the one to keep building on).
- Each new test uses a distinct `projectId` (`project-reorder`, `project-priority`, `project-assignee`, `project-tag`) rather than reusing `project-1` from the pre-existing test. Root cause investigated: `lib/realtime/shared-topic-channel.ts` keys its channel/listener registry by `(supabase client instance, topic string)`; the test file's `fakeSupabase` object is a module-level singleton shared across all tests in the file, so a second `<Board projectId="project-1">` mount in a later test would silently reuse the first test's cached channel entry and never call `.on()` again, leaving `onCalls` empty and giving a false negative. Distinct project ids per test sidestep this without touching the (working, well-documented) production dedup logic.
- Cross-lane tests (priority/assignee/tag) construct `active.id`/`over.id` as `${sourceLaneKey}::${taskId}` / `${targetLaneKey}::${taskId}` per `board.tsx`'s documented `parseDndId` convention, with source and target tasks sharing the same `status` ("todo") so the drop is a pure cross-lane reassignment (no `moveAndReorderTask` call) plus a same-status reposition (`reorderTask`) — matching `handleDragEnd`'s actual branching (`crossLane && groupBy === X` only fires alongside `reorderTask`, never in isolation, when status is unchanged).
- The three cross-lane tests' final realtime-applied assertion checks every `[data-status="in_review"]` node in the DOM (`querySelectorAll` + `.some(...)`), not just the first, because a grouped (Swimlane) render produces one status column PER LANE — `querySelector` alone risked matching an empty lane's column rather than the lane the task actually lives in.

## Out-of-scope work needed
None identified specific to this feature. The rest of scrutiny-3's findings (MAJOR-1 AS-016 approval-actions request-changes handler, MAJOR-3 requestPortalTaskChanges race) are outside F026's assigned assertions (AS-026/AS-027) and are already visible as in-progress changes from a concurrent worker (`components/portal/approval-actions.test.tsx`, `lib/actions/portal-approval.ts`, `tests/unit/portal-approval-action.test.ts` were modified but NOT staged/committed by this worker, per the explicit instruction not to touch `components/portal/` or `lib/actions/`).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose per-test unique `projectId` values over resetting the `shared-topic-channel.ts` module registry between tests (e.g. via `vi.resetModules()`), since the latter would require restructuring the test file's import order (the registry lives in a real, un-mocked module) and the former is a one-line change per test with no risk to the module under test.

## Notes for the next worker
- `lib/realtime/shared-topic-channel.ts` has a detailed doc comment explaining why it dedupes `channel()`/`.on()`/`.subscribe()` calls per `(client, topic)` pair — worth reading before writing any test that mounts more than one Realtime-subscribing component against the same fake Supabase client instance in the same file; reuse the same topic across tests only if you actually want to test the dedup behavior itself.
- The four new tests are legitimately real drags (real `handleDragEnd`, real `parseDndId`/`groupTasksIntoSwimlanes` logic, mocked only at the dnd-kit `DndContext`/`DragOverlay` and Supabase-client/Server-Action boundaries) — not source-text or regex assertions, consistent with round 1's explicit rejection of that pattern.
- No MCP tools were used — this is a pure client-side React/test change with no external service or live schema touched.
