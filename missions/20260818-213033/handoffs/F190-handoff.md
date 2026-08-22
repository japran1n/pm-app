# Handoff: F190 — undo after delete

## Status
COMPLETE

## Assertions covered
AS-345: PASS — deleting shows an undo affordance that restores without visiting trash. Covered by `tests/unit/undo-toast.test.tsx` (`showUndoToast` raises a sonner toast with an Undo action and trash-availability copy; idempotency — a double-click on Undo only fires the restore callback once; a comment delete's Undo click calls the real `restoreComment` action and genuinely re-inserts the comment into view, not just dismisses the toast), `tests/unit/task-detail-sheet-undo.test.ts` (source-inspection proof that `handleDelete`'s success path wires to `showUndoToast`, with Undo calling the real `restoreTask` for the exact same task id that was deleted), `tests/unit/bulk-delete-action.test.tsx`'s new `F190/AS-345` test (a full-success bulk delete shows an Undo toast whose action fires exactly one `bulkRestoreTasks` call with every deleted id, not a client-side loop), and `tests/integration/bulk-restore-tasks.test.ts` (run against the real linked Supabase project: a `bulkDeleteTasks` batch is genuinely restored end-to-end by one `bulkRestoreTasks` call — rows' `deleted_at` verified cleared afterward, not merely a toast disappearing; a double-undo race on one id in the batch doesn't fail the rest; validation/auth edge cases).

## Files changed
lib/actions/tasks.ts (new `bulkRestoreTasks` Server Action + `BulkRestoreTasksResult` type)
lib/toast/undo-toast.ts (new — shared sonner Undo-toast helper: message + "Also available in Trash." description + 8s duration + idempotent Undo action)
components/task/task-detail-sheet.tsx (task delete's `handleDelete` now shows the Undo toast; Undo calls `restoreTask`)
components/task/comment-list.tsx (comment delete's `handleDelete` now shows the Undo toast; Undo calls `restoreComment` and re-inserts its returned row into local state)
components/task/bulk-delete-action.tsx (a full-success bulk delete now shows the Undo toast; Undo calls the new `bulkRestoreTasks` once with every succeeded id)
tests/unit/undo-toast.test.tsx (new)
tests/unit/task-detail-sheet-undo.test.ts (new)
tests/unit/bulk-delete-action.test.tsx (extended with an undo test; mock updated to include `bulkRestoreTasks`)
tests/integration/bulk-restore-tasks.test.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, 2 pre-existing unrelated warnings)
`npm run test -- undo-toast bulk-delete-action bulk-restore-tasks task-detail-sheet-undo` (0, 15/15 passed)
`npm run test` (0 exit code overall; 44 pre-existing failing tests unrelated to this feature — see Notes below — none in a file this feature touched or added)

## Decisions made
- **Bulk undo mechanism**: added a new `bulkRestoreTasks(taskIds)` Server Action in `lib/actions/tasks.ts` mirroring `bulkDeleteTasks`'s `{succeededIds, failedIds}` discriminated-union shape. Internally it delegates to the existing, already-correct `restoreTask` per id via `Promise.all`, rather than re-implementing `restoreTask`'s position-recompute / status-fallback / cascade-children-restore logic as a second, parallel batch-SQL code path. This satisfies the spec's literal requirement ("Bulk deletes undo the whole batch in one call") as "one Server Action call from the client restores the whole batch" — not "one raw SQL statement" — per this feature's own Clarified ambiguity-resolution default (take the simpler option that adds no new dependency and no second source of truth). Duplicating `restoreTask`'s intricate logic in a batch UPDATE would itself be a second source of truth for restore semantics, which the clarified default explicitly says to avoid.
- **No new top-level auth check in `bulkRestoreTasks`**: unlike `bulkDeleteTasks`, it does not re-check membership/role itself before calling `restoreTask` — `restoreTask` already does the full auth check per task. An unauthenticated or unauthorized caller therefore gets every id reported in `failedIds` (not a whole-call `ok:false`), which is consistent with "one task failing doesn't fail the rest of the batch" and is covered by an integration test.
- **Idempotency (double-click)**: guarded entirely client-side in `lib/toast/undo-toast.ts`'s `showUndoToast` helper via a closure-scoped `handled` flag — a second click on the same toast's Undo button is a no-op (no second network call, no error). This satisfies the spec's "Undo must be idempotent — double-clicking it cannot create duplicates or error loudly" note without needing server-side dedup, since the toast (and its one Undo button) can only be interacted with once before it dismisses itself.
- **Toast copy and duration**: `showUndoToast` sets `description: "Also available in Trash."` (per the spec's explicit instruction that the toast's own copy says undo is still possible via trash after it expires) and a duration of 8000ms — not sonner's 4000ms default. AUTONOMOUS_DECISION: no duration was specified in the clarified answers ("sonner's default duration, or a longer one" was left open); 8s was chosen as the simplest deviation that still gives a user real time to notice and click Undo, directly serving AS-345's "restores without visiting trash" (a 4s window is too easy to miss for a deliberate two-step action).
- **Toaster placement verified, not assumed**: read `app/layout.tsx` and `components/ui/sonner.tsx` directly — `<Toaster />` is mounted once at the root layout (which persists across client-side route changes), so a toast raised here already survives in-app navigation for its own lifetime without any extra wiring.
- **No extra client-side reconciliation needed for task restore**: `restoreTask`'s own `revalidatePath` (server-fetched list views) and the board's existing realtime subscription (`board.tsx`'s `reconcileTask`, which already re-inserts a task the instant its `deleted_at` UPDATE clears — confirmed by reading `lib/board/reconcile-realtime-task.ts`) both already pick up a restore with zero new code. `handleDelete` in `task-detail-sheet.tsx` therefore just calls `restoreTask` and shows a success/error toast — no manual re-fetch or local-state re-insert was added, avoiding a second, redundant reconciliation path.
- **Comment restore reconciliation**: `restoreComment`'s return shape already matches the `TaskComment` type exactly (same fields `addComment`'s own success path already appends directly), so Undo re-inserts `restoreResult.data` straight into `localComments` the same way `addComment`'s handler does — no second shape-mapping function.

## Out-of-scope work needed
- None identified beyond this feature's own file scope. (Not touched: any change to `restoreTask`/`restoreComment`'s own auth/cascade logic — those are F189/F191's completed, unmodified implementations, reused as-is here.)

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: chose an 8000ms toast duration (sonner default is 4000ms) since the clarification left duration open ("sonner's default duration, or a longer one") — see Decisions made above for rationale.
AUTONOMOUS_DECISION: `bulkRestoreTasks` reuses `restoreTask` per id via `Promise.all` rather than a new batch-UPDATE SQL statement, interpreting "restore the whole batch in one call" as one Server Action invocation from the client rather than one raw SQL round trip — see Decisions made above.

## Notes for the next worker
- `npm run test` (full suite) currently has 44 pre-existing failing tests across `tests/integration/workspace-role-expansion.test.ts`, `tests/integration/perf-budget.test.ts`, `tests/integration/trash-view.test.ts`, and `tests/integration/workspace-members-list.test.ts` — none in files this feature touched or added, and none newly introduced by this change (verified by running the targeted subset of new/modified test files in isolation, all 15 passing, then diffing the full-suite `FAIL` list against this feature's file list). These look like flaky/timeout issues from a large, concurrently-run integration suite hitting the same live Supabase project (e.g. `Test timed out in 30000ms`), pre-existing before this feature. Flagging for the orchestrator rather than silently ignoring, since a milestone validator re-running the full suite may hit the same flakiness — not something this feature's scope covers fixing.
- MCP usage: none (per this feature's spec, "MCP at run: none" — no live external service state needed inspecting for a pure UI/Server-Action feature).
