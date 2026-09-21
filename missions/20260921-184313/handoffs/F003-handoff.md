# Handoff: F003 — getQaReturns query

## Status
COMPLETE

## Assertions covered
AS-023: PASS — `getQaReturns` returns a task assigned to the caller when someone else moved it out of a QA-category (or QA-named) status into a still-open status within 7 days; excludes self-moves, moves older than 7 days, moves into done/cancelled, and moves not originating from a QA status. Verified with 9 unit tests in `tests/unit/qa-returns.test.ts` (all pass).

## Files changed
lib/queries/my-tasks.ts
tests/unit/qa-returns.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run tests/unit/qa-returns.test.ts` (0, 9/9 passed)
`npx vitest run tests/unit/my-tasks-bucket.test.ts tests/unit/qa-returns.test.ts` (0, 23/23 passed — sanity check against sibling test in same file)
`git commit` (0)

## Decisions made
- Grepped `lib/actions/tasks/ordering.ts` (`moveTaskStatus`, `moveAndReorderTask`) and `lib/actions/tasks/lifecycle.ts` (`deleteTask` restore path) to confirm `task_activity.old_value`/`new_value` for `field: 'status'` store the plain TEXT status name (`tasks.status`), never `status_id` — `diffTaskFields({ status: taskRow.status }, { status: updated.status })` is the write path. Documented this in the new code's header comment so a future reader doesn't have to re-derive it.
- Since `tasks.status` is per-project free text (F218-F223), resolving old/new status category requires joining `project_statuses` on `(project_id, name)`, not on `status_id` — the activity row never carries a status_id, only the name captured at write time.
- Followed the spec's clarified matching rule literally: "old" status counts as QA-origin if its `project_statuses.category === 'qa'` OR its name contains "qa" (case-insensitive); "new" status counts as open if its category is present and is neither `done` nor `cancelled` — a status with an unrecognized/missing category is treated as open (conservative default: don't hide a real return because the status lookup was incomplete).
- One batched `project_statuses` read for every project touched by the caller's assigned tasks (not per-row), matching this file's existing `getMyTasks` "one round trip" convention.
- Result capped at 10, newest-first, per spec; sorting done in Supabase via `.order("created_at", { ascending: false })`, then a `break` once 10 matches are collected (no separate re-sort needed since input is already ordered).
- Test mock: extended `tests/unit/helpers/query-filter-mock.ts` usage pattern (not the shared file itself) with two file-local filter functions (`neqFilter`, `gtFilter`) and a `dottedEqFilter` helper for the `tasks.projects.workspace_id`-style embed filter, since the shared helper doesn't cover `.neq()`/`.gt()`/dotted-path filters and this feature's spec didn't name that shared file as in-scope to modify.

## Out-of-scope work needed
None identified — this feature is a single, self-contained read query per its own spec's "Touches" (implicitly just `lib/queries/my-tasks.ts`). Wiring `getQaReturns` into an actual home/dashboard UI component is presumably a separate feature (not named in F003's spec) and was not started here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Treated a status whose category can't be resolved (name not found in that project's `project_statuses`, e.g. stale/renamed data) as "open" for the purposes of the "new status must be open" check, rather than excluding it — the spec doesn't address this edge case explicitly, and silently dropping a real QA-return because of a stale status_id lookup seemed like the wrong failure direction for an "attention item" feature whose whole purpose is surfacing regressions.

## Notes for the next worker
- `firstRelated<T>` (already defined earlier in `lib/queries/my-tasks.ts` for `getMyTasks`) is reused as-is for `getQaReturns`'s nested `tasks`/`projects` embed unwrapping — no new helper needed.
- No MCP usage for this feature: it's pure application-code query logic against already-existing tables (`task_assignees`, `task_activity`, `project_statuses`), no schema/migration/policy change involved. Per `worker-mcp-usage` skill's decision tree, this is squarely "implement business logic → no MCP."
- Noticed but did not touch: `lib/queries/dashboard.ts` and two other test files (`tests/unit/dashboard-kpi.test.ts`, `tests/unit/my-projects-progress.test.ts`) were already modified/untracked in the working tree when I started (presumably other workers' in-flight work in this same mission run) — left those alone and only staged/committed the two files this feature spec covers.
