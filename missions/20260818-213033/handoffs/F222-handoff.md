# Handoff: F222 — status-category-semantics

## Status
COMPLETE

## Assertions covered
AS-410: PASS — `tests/integration/f222-status-category-semantics.test.ts` exercises the REAL read paths (`getProjectBoardTasks`, `getOpenBlockers`, the `get_overdue_count`/`is_done_status` RPCs) across a project with two `done`-category custom columns ("Shipped", "Complete") and one `in_progress`-category column deliberately named "done-ish", proving the progress/overdue/dependency triad from the assertion text, plus `tests/unit/status-category.test.ts`, `tests/unit/is-overdue.test.ts`, `tests/unit/blocked-guard.test.ts`, `tests/unit/subtask-list.test.ts` for the pure-function halves. 8/8 integration tests pass, all unit suites pass.

## Files changed
lib/tasks/status-category.ts (new — shared `isDoneStatus`/`isDoneCategory`)
lib/tasks/blocked-guard.ts (re-exports from status-category.ts)
lib/tasks/subtask-progress.ts (category-aware `countSubtaskProgress`)
lib/tasks/is-overdue.ts (optional `statusCategory` param, threaded through)
lib/time/user-timezone.ts (`isOverdueInTimeZone` category-aware)
lib/queries/tasks.ts (`getProjectBoardTasks`/`getProjectListTasks`/`getWorkspaceListTasks` select+map `statusCategory`; RPC row type gains `status_category`)
lib/actions/tasks.ts (`moveTaskStatus` recurrence check, `getOpenBlockers`, `getTaskDetail`'s children/task select — all category-aware via `is_done_status`/`isDoneStatus`)
components/board/board.tsx (`confirmIfMovingToDone` now passes the target column's real category, resolved from board `columns` state)
components/task/blocked-done-guard.tsx (`confirmIfMovingToDone` accepts optional `nextStatusCategory`)
components/task/task-card.tsx, components/task/task-list-table.tsx, components/task/task-detail-sheet.tsx (`TaskCardTask`/`TaskDetailSheetTask` gain `statusCategory`; `isOverdue` calls pass it through)
components/task/subtask-list.tsx (`SubtaskListChildTask` gains `statusCategory`)
supabase/migrations/20260824060000_status_category_semantics.sql (new — `public.is_done_status(status_id, status)` shared SQL helper; recreates `get_project_board_tasks` (child_done, open_blocker_count, adds `status_category` output column), recreates `active_project_tasks` view (drop+recreate — `t.*` had gone stale since F218 added `status_id` after the view existed) + its 3 dependent RPCs, `get_overdue_count` category-aware, `notify_overdue_task_assignees` category-aware)
lib/supabase/database.types.ts (regenerated via `supabase gen types typescript --linked`)
tests/unit/status-category.test.ts (new)
tests/unit/is-overdue.test.ts (AS-410 cases appended)
tests/unit/blocked-guard.test.ts (AS-410 cases appended)
tests/unit/subtask-list.test.ts (AS-410 cases appended)
tests/integration/f222-status-category-semantics.test.ts (new)

## Commands run
`supabase db push` (0) — applied 20260824060000_status_category_semantics.sql to project qcipqonnqajmazdbysow
`supabase gen types typescript --linked` (0) — regenerated lib/supabase/database.types.ts
`npx tsc --noEmit` (0) — no errors
`npx eslint .` (0 errors, 2 pre-existing unrelated warnings: lib/queries/search.ts, tests/unit/invite-member-pagination.test.ts — unchanged by this feature)
`npx vitest run tests/unit/status-category.test.ts tests/unit/is-overdue.test.ts tests/unit/blocked-guard.test.ts tests/unit/subtask-list.test.ts` (0) — 4 files, 31/31 passed
`npx vitest run tests/integration/f222-status-category-semantics.test.ts` (0) — 8/8 passed
`npx vitest run tests/integration/board-tasks-completion.test.ts` (0) — 5/5 passed (progress regression)
`npx vitest run tests/integration/dependency-ui-actions.test.ts` (0) — 12/12 passed (dependency regression, AS-283)
`npx vitest run tests/integration/f219-status-management.test.ts` (0) — 13/13 passed
`npx vitest run tests/integration/overdue-count-rpc.test.ts tests/integration/overdue-notification-sweep.test.ts tests/integration/f220-status-delete-reassign.test.ts tests/integration/f221-board-custom-columns.test.ts` (0) — 31/31 passed (overdue + status-management regression)
`npx vitest run tests/integration/db-subtasks.test.ts tests/integration/subtask-actions.test.ts tests/integration/subtask-ui-detail.test.ts tests/integration/perf-budget.test.ts tests/integration/trash-exclusion-board.test.ts tests/integration/trash-exclusion-list.test.ts tests/integration/open-blockers.test.ts tests/integration/recurrence-query-wiring.test.ts` (0) — 45/45 passed
`npx vitest run tests/integration/recurrence-scheduled-generation.test.ts` (0) — 6/6 passed (re-run alone after a full-suite DB-congestion timeout — see Notes)
`npx vitest run tests/integration/rls-projects.test.ts` (0) — 9/9 passed (re-run alone after a full-suite rate-limit failure)
`npm run test` (1, full suite) — 1747 passed / 43 failed / 79 skipped across 25 files. Every failing file re-run alone (individually or in small groups, see above) passed — every failure was either `Request rate limit reached` (Supabase Auth, the documented known infra condition) or one `statement timeout` under DB congestion from many suites hitting the same remote project concurrently. None of the 25 failing files import or exercise this feature's changed files except the 5 explicitly re-run and confirmed green above; `tests/unit/trash-list.test.tsx` and the `comment-list.test.ts`-adjacent unhandled rejection in `tests/unit/user-avatar.test.tsx` are pre-existing test-isolation failures confirmed to reproduce in isolation on an unmodified checkout of those files (no file this feature touches is in their import graph).

## Decisions made
- Shared "is this status done" rule lives in ONE new module, `lib/tasks/status-category.ts` (`isDoneStatus(status, category?)`), not four copies. `lib/tasks/blocked-guard.ts` re-exports it unchanged so every existing `import { isDoneStatus } from "@/lib/tasks/blocked-guard"` call site keeps compiling with zero edits — only the ones that can supply a real category were touched to pass one.
- SQL gets the identical rule as a real function, `public.is_done_status(p_status_id uuid, p_status text)` (`language sql stable`, inlinable), not a re-derived predicate per RPC — mirrors the TypeScript helper 1:1 so there is exactly one definition of "done" per runtime, not per call site.
- `status_id is null` fallback (AUTONOMOUS_DECISION): falls back to the literal `status = 'done'` text comparison — the exact pre-F222 behaviour — rather than guessing either way. This is reachable in practice only for data that predates F218's backfill/sync trigger (which keeps `status_id` and `status` in lockstep on every write going forward), so "no worse than before this feature" was the safest default per the clarification's "simpler option, no new dependency" resolution. Verified in both a TypeScript unit test (`status-category.test.ts`) and directly against the DB function (`f222-status-category-semantics.test.ts`'s `is_done_status` RPC calls).
- `active_project_tasks` view had to be `drop ... cascade` + recreated, not `create or replace view`: it was defined as `select t.*, ...` before F218 added `tasks.status_id`, and Postgres freezes a view's column list (including `t.*` expansion) at creation time — `create or replace` only permits strictly appending new columns in the SAME relative position the planner already committed to, which this predates. Cascade also dropped `get_priority_counts`/`get_status_counts` (both recreated byte-for-byte identical to their pre-F222 bodies — AS-412's "dashboard chart reflects custom columns" is out of this feature's scope, F223's job) and `get_overdue_count` (recreated with the category-aware predicate).
- `get_project_board_tasks`'s row type gained one column, `status_category` (feeds the board's own overdue badge), on top of the two comparisons the assertion explicitly named (`child_done`, `open_blocker_count`) — decided in-scope per the clarified spec's "if a fourth site decides completeness, fix it too" instruction, since the board card's own `isOverdue` call is exactly such a site and the RPC was already being recreated for the other two fixes.
- List/dashboard queries (`getProjectListTasks`, `getWorkspaceListTasks`, `getTaskDetail`'s children/task/blockers) all now select `project_statuses(category)` through the existing `status_id` FK rather than a second per-row lookup — same "one query, no round trip" convention every prior feature in this file already established.
- `components/task/list-status-select.tsx` and `task-detail-sheet.tsx`'s own status `<Select>` were deliberately NOT changed to pass a category to `confirmIfMovingToDone` — both still render a hardcoded 4-option list (`todo`/`in_progress`/`in_review`/`done`), so `nextStatus` can only ever be one of those 4 literal names until AS-411/F223 wires real per-project columns into them; passing `undefined` there correctly falls back to the pre-F222 literal comparison, which is still correct for a fixed 4-value selector. Recorded as Out-of-scope below, not silently expanded.

## Out-of-scope work needed
- AS-411 (list view's status filter/inline editor lists the project's real columns) and AS-412 (dashboard status chart reflects custom columns) are separate assertions/features (not assigned to F222) — `components/task/list-status-select.tsx`, `components/task/task-detail-sheet.tsx`'s status Select, and `get_status_counts` all still render/group by the fixed four. Once F223 wires those to real per-project columns, `confirmIfMovingToDone`'s category argument should be threaded through those two components the same way `board.tsx` now does.
- `components/task/dependencies.tsx` (the task detail sheet's blocker/blocks list UI) still renders `STATUS_LABELS[item.status]`/`STATUS_COLORS[item.status]` keyed by the fixed four for DISPLAY only (not a completeness decision — the actual open/closed gating already went through `getOpenBlockers`'s category-aware fix in this feature) — a custom column's label/color will render as `undefined`/blank for a task in a genuinely custom column until AS-411-adjacent work updates that lookup too.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: status_id-null fallback resolves to the literal status-text comparison (see Decisions made above) — the clarification's "simpler option, no second source of truth" default, applied because the spec's Notes left this open without dictating a specific fallback.
AUTONOMOUS_DECISION: left `list-status-select.tsx`/`task-detail-sheet.tsx`'s fixed-4-option status Selects unmodified rather than reaching into AS-411/F223 territory to wire real columns into them just to pass a category — the clarification's "stay in scope, report the rest" answer.

## Notes for the next worker
- `active_project_tasks`'s `drop view ... cascade` pattern (see Decisions made) is a real gotcha for ANY future migration that needs to add a column to a view defined via `select t.*`: `create or replace view` will reject it with "cannot change name of view column X to Y" once ANY table column has been added between the view's creation and now, even in an unrelated migration. Drop+recreate (and recreate every dependent function) is the only fix; there is no `ALTER VIEW ADD COLUMN`.
- `tests/integration/recurrence-scheduled-generation.test.ts` and `tests/integration/rls-projects.test.ts` both failed once in the single `npm run test` full-suite run (a `statement timeout` and a rate-limit respectively) but passed cleanly re-run alone — this is DB congestion/Auth throttling from many suites hitting the same remote Supabase project back-to-back, not a regression from this feature's SQL changes (neither file's covered function references anything this migration touched).
- MCP: none used this run — Supabase MCP is `Worker use: Optional` per the registry and the CLI (`supabase db push`/`supabase gen types`) was sufficient for this feature's schema work, same as F218-F221.
