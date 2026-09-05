# Handoff: F014 — Fix priority null-collapse + discriminating tests

## Status
COMPLETE

## Assertions covered
AS-007: PASS — new test `test_AS_007_clearing_priority_to_null_updates_immediately_before_the_server_responds` confirms clearing "high" -> "No priority" shows immediately, pre-existing set-to-"high" test also passes.
AS-008: PASS — existing revert-on-failure and revert-on-throw tests still pass unchanged.

## Files changed
components/task/task-detail-sheet.tsx
tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx

## Commands run
`npx vitest run tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx` (0) — 4/4 passed
`npm test` (0) — full suite exit code 0; some pre-existing integration/RLS tests report per-file failures against a live Supabase project unrelated to this feature (test-runner overall exit still 0)
`npm run lint` (0) — 0 errors, 13 pre-existing warnings unrelated to this feature
`npx tsc --noEmit` (0)

## Decisions made
- Root cause: `(optimisticPriority ?? task.priority) ?? NO_PRIORITY_VALUE` used `??`, which cannot distinguish "no optimistic override yet" from "explicitly cleared to null" — both look like `null`/`undefined` to `??`, so a cleared priority collapsed back to the stale `task.priority`.
- Chose the sentinel/ternary approach specified in the clarified spec: `useOptimistic`'s baseline argument is now always the literal `undefined` (never `task?.priority`), meaning "no override in this render". `null` set via `setOptimisticPriority(null)` is a real, distinct value meaning "cleared to No priority". Display and guard logic use `optimisticPriority !== undefined ? optimisticPriority : task.priority` instead of `??`.
- This required re-typing the hook as `useOptimistic<TaskDetailSheetTask["priority"] | undefined>(undefined)` since the previous baseline value carried the source-of-truth type (`Priority | null`) without `undefined`.
- Fixed both occurrences named in the spec: the early-return guard (`handlePriorityChange`, originally ~:1002 before edits shifted line numbers by +4 due to added comment lines) and the Select `value` binding (originally ~:1457).
- Added the AS-007 null-transition test using a one-off `getTaskDetail` mock override (task starts with `priority: "high"`) rather than editing the shared default fixture, to avoid touching the other tests in the same file that rely on the default `priority: null` starting state.

## Out-of-scope work needed
None identified within this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Followed the spec's explicitly preferred fix (sentinel/ternary via `useOptimistic<...|undefined>(undefined)`) rather than the simpler alternative of just deleting the redundant `?? task.priority` fallback (since `optimisticPriority` already always reflects the current source-of-truth value when no transition is pending). Both would fix the bug; the sentinel approach was chosen because it is what the clarified task instructions explicitly directed.

## Notes for the next worker
- MCP: none used, per feature spec ("MCP at run: none").
- The `npm test` full-suite run shows failures in `tests/integration/f228-saved-view-actions.test.ts`, `tests/integration/f326-rls-hardening.test.ts`, `tests/integration/rls-project-favorites.test.ts`, and `tests/integration/f224-board-swimlane-grouping.test.ts` — these hit a live Supabase project and are pre-existing/unrelated to task-detail-sheet.tsx or priority handling; they were already failing before this change and are out of scope for F014.
- Working tree had unrelated pre-existing modifications (`components/my-tasks/personal-todo-list.tsx`, `tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx`, `missions/CURRENT`, `supabase/.temp/*`) left untouched by this commit — only the two files listed under "Files changed" were staged and committed.
