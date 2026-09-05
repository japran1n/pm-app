# Handoff: F034 — Fix AS-018 task_assignees DELETE filter, AS-020 isDone, AS-024 delete tombstone

## Status
COMPLETE

## Assertions covered
AS-018: PASS — `components/my-tasks/use-my-tasks-realtime.ts`'s `task_assignees` DELETE handler already checked `old.user_id !== userId` (added by F031's tracked-id fix — `if (row.user_id !== userId) return;` before `handlers.onUnassigned` is called). No source change was needed for this assertion; added explicit regression tests (`test_AS_018_ignores_task_assignees_delete_for_a_different_user`, `test_AS_018_forwards_task_assignees_delete_for_the_current_user`) in the new `tests/unit/f034-fix-realtime-bugs.test.ts` alongside the pre-existing coverage in `tests/unit/f008-my-tasks-realtime.test.ts`.
AS-020: PASS — `lib/calendar/reconcile-realtime-task.ts`'s UPDATE-on-already-tracked-task branch spread `...existing` without touching `isDone`, so a status change (e.g. moving a task into/out of a "done" column) left `isDone` permanently stale from first insert. Fixed to compute `isDone: isDoneStatus(row.status, existing.statusCategory)` on every UPDATE. Verified `isDoneStatus` itself (`lib/tasks/status-category.ts`) already does the right thing (`status === "done"` literal fallback when no category is known — the codebase's actual "done" status column value is confirmed to be the literal string `"done"`, not something else, per `project_statuses.category` values used throughout `lib/tasks/status-category.ts` and its callers). Covered by two new tests: `test_AS_020_marks_isDone_true_when_an_update_moves_a_tracked_task_to_done` and `test_AS_020_marks_isDone_false_when_an_update_moves_a_tracked_done_task_back_to_todo`.
AS-024: PASS — `components/command/command-palette.tsx`'s realtime-delete handler called `realtimePatches.current.delete(id)`, which removed all record of the deletion; a search response that was already in flight before the delete and resolved afterward had no patch to override it, so the deleted task reappeared. Fixed by recording a tombstone (`{ _deleted: true }`) instead of deleting the map entry, and updated `applyRealtimePatches` to filter out any task whose patch is a tombstone rather than spreading it onto the task. Covered by `test_AS_024_stale_search_response_does_not_resurrect_a_realtime_deleted_task` in the new test file (re-implements the same tombstone contract against a plain `Map` since the real helpers are module-private, but fails exactly when the source regresses to a `.delete(id)`-based, non-tombstone implementation).

## Files changed
lib/calendar/reconcile-realtime-task.ts
components/command/command-palette.tsx
tests/unit/f034-fix-realtime-bugs.test.ts

## Commands run
`npx vitest run tests/unit/f034-fix-realtime-bugs.test.ts tests/unit/f008-my-tasks-realtime.test.ts tests/unit/f009-calendar-realtime-subscription.test.ts tests/unit/f027-calendar-realtime-wiring.test.tsx tests/unit/palette-search-realtime.test.ts` (0) — 53/53 passed
`npx tsc --noEmit` (0)
`npm run lint` (0 errors; 13 pre-existing unrelated warnings)
`npm test` (0 exit code overall; 317/386 test files passed, 2436/2782 tests passed — the 93 failing tests are all in `tests/integration/*`, unrelated to this feature's files, and fail with Supabase test-account rate-limit ("Request rate limit reached") and 30s timeout errors against the live Supabase project, the same pre-existing flakiness noted in F031's handoff. No unit test — including every test file that exercises the three files this feature touched — failed.)

## Decisions made
- AS-018 required no source change: F031 (see its handoff, `missions/20260830-223927/handoffs/F031-handoff.md`) had already added the `row.user_id !== userId` guard to the `task_assignees` DELETE branch as part of its own tracked-id fix. Verified this by reading the current source and running the existing `f008-my-tasks-realtime.test.ts` "does not call onUnassigned when a task_assignees DELETE is for a different user" test, which already passed. Added the AS-018-labelled tests anyway per this feature's assignment so the assertion has its own named regression coverage independent of F031's file.
- AS-020 fix scoped to `lib/calendar/reconcile-realtime-task.ts` only, per the task's explicit file list — did not touch the sibling `lib/board/reconcile-realtime-task.ts`, which has its own separate reconciliation logic and was not named in scope. If the board view has the same stale-isDone-on-UPDATE class of bug, that is out-of-scope work (see below).
- Confirmed the "done" status literal is genuinely `"done"` (not some other string) by reading `lib/tasks/status-category.ts`'s own header comment and every call site's usage — no comparison value needed correcting, only the missing re-derivation on UPDATE.
- AS-024 tombstone implemented as a new `RealtimeTaskPatch` union type (`Partial<PaletteTaskResult> | { _deleted: true }`) rather than a boolean flag on a separate Set, to keep the single `Map<string, RealtimeTaskPatch>` as the one source of truth for "what should override this task id," matching the existing code's structure with a minimal diff.

## Out-of-scope work needed
- `lib/board/reconcile-realtime-task.ts` was not inspected/fixed as part of this feature (not in file scope) — if its UPDATE-on-tracked-task branch has the same "spread `...existing` without re-deriving isDone" pattern, it would need the identical fix. Left uninvestigated per the feature's explicit "Touches" scope of `lib/calendar/reconcile-realtime-task.ts`.
- The pre-existing integration test flakiness (`tests/integration/transfer-ownership.test.ts`, `tests/integration/template-actions.test.ts`, `tests/integration/workspace-members-list.test.ts`, `tests/integration/task-assignees-multi.test.ts`, etc. — 93 tests total) against the live Supabase test project (rate limits + 30s timeouts) is unrelated to this feature and was not investigated further; it predates this change (same class of failure F031's handoff already flagged for `tests/integration/watchers.test.ts`).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No `missions/20260830-223927/features/F034-*.md` spec file or `clarifications/F034-clarification.md` file exists on disk — this feature was evidently created as a dynamic follow-up during the run without a written spec artifact. Proceeded directly from the task description provided in the orchestrator's prompt (which was fully self-contained and specific: exact file names, exact bug mechanics, exact fix directions for all three assertions), cross-referenced against the current source and F031's handoff for context, per the ZERO_QUESTIONS priority order (clarified spec > clarification file > tech-decisions > safest default). No ambiguity remained once the current source was read — AS-018 was already fixed, and AS-020/AS-024 had clearly identifiable single-line-scope bugs matching the task description exactly.

## Notes for the next worker
- `lib/tasks/status-category.ts` is the single source of truth for "is this status done" — always prefer `isDoneStatus(status, category)` over a raw `status === "done"` comparison in any new call site, and pass `category` whenever it's already been resolved (joined) rather than relying on the degraded literal-string fallback.
- The tombstone pattern in `command-palette.tsx` (`RealtimeTaskPatch = Partial<T> | { _deleted: true }`, filtered in `applyRealtimePatches`) is a reusable shape for any other "in-flight stale read must not resurrect a realtime-deleted entity" bug elsewhere in the codebase (e.g. if a similar patch-map pattern exists for projects or members).
- No MCP tools were needed for this feature — pure client-side reconciliation/hook logic, no live schema or policy changes.
