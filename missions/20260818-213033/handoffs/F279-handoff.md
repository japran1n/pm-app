# Handoff: F279 — restore the board query's performance budget

## Status
COMPLETE

## Assertions covered
AS-156 (mission 1): PASS — `getProjectBoardTasks` p95 measured at 142.4ms (min=106.5 max=154.6 mean=126.9) over 20 runs against the live linked Supabase project, well under the unchanged 500ms `PERF_BUDGET_MS`. Before this fix: p95=520.6ms (per the feature spec's stated regression). Budget was NOT raised.

## Files changed
supabase/migrations/20260819110000_rpc_project_board_tasks.sql
lib/queries/tasks.ts
tests/integration/board-reload-persistence.test.ts

## Commands run
`supabase db push --linked --yes` (0) — applied the new `get_project_board_tasks` RPC to the linked project (qcipqonnqajmazdbysow)
`npx vitest run tests/integration/perf-budget.test.ts` (0) — AS-156 p95=142.4ms, AS-136 (dashboard RPCs, unaffected by this change) also PASS
`npx vitest run tests/integration/board-tasks-completion.test.ts tests/integration/dependency-ui-actions.test.ts tests/unit/checklist-ui-render.test.ts tests/unit/task-card-blocked-indicator-render.test.ts tests/unit/task-card-completion-render.test.ts tests/unit/task-completion.test.ts` (0) — 42/42 passed, covers AS-272/AS-273/AS-283
`npx vitest run tests/integration/board-columns-render.test.ts tests/integration/board-reload-persistence.test.ts tests/integration/list-status-inline-edit.test.ts tests/integration/subtask-ui-detail.test.ts tests/integration/task-key-display-queries.test.ts tests/unit/board-soft-delete-filter.test.ts` (0) — 20/20 passed (all other existing consumers of `getProjectBoardTasks`)
`npx tsc --noEmit` (0)
`npx eslint .` (0) — 1 pre-existing unrelated warning in lib/queries/search.ts (`_titleMatches` unused), not touched by this feature

## Decisions made
- Consolidated the four separate whole-project queries (main task select from F042, child/subtask count from F150, checklist count from F154, open-blocker count from F157) into one new Postgres RPC, `get_project_board_tasks(p_project_id uuid)`, using `left join lateral` subqueries so it stays one row per task and one round trip.
- RPC is `language sql stable security invoker`, matching this project's established safe convention (`get_priority_counts`, `supabase/migrations/20260818054815_rpc_priority_counts.sql`, itself citing an M6 scrutiny finding). Because it's read-only, there is no reason to reach for SECURITY DEFINER at all — RLS (`tasks_select_active_members`, `checklist_items`/`task_dependencies` policies) applies exactly as it would for four separate direct SELECTs. This satisfies the spec's hardening constraint by construction (invoker path, no re-assertion needed since nothing is bypassed).
- `lib/queries/tasks.ts`'s `getProjectBoardTasks` now calls `supabase.rpc("get_project_board_tasks", { p_project_id: projectId })` and maps the returned rows through the same `computeTaskCompletion` helper as before — `TaskCardTask[]` return shape is byte-for-byte unchanged, so no caller needed updating.
- Removed the now-unused `countSubtaskProgress`/`countChecklistProgress` imports from `lib/queries/tasks.ts` (their counting logic moved into the RPC's lateral joins); `computeTaskCompletion` is still used identically.
- `"position"` had to be double-quoted in the RPC's `returns table` column list and in the `order by` clause — `supabase db push` failed with a plain syntax error on the bare `position` keyword there (it's fine as a bare column reference inside a normal SELECT list, just not in that specific grammar position).
- `tests/integration/board-reload-persistence.test.ts` hand-rolls a `@/lib/supabase/server` mock object with only a `.from()` method routed to the real admin client — it broke (`supabase.rpc is not a function`) once `getProjectBoardTasks` started calling `.rpc(...)`. Added a matching `.rpc()` passthrough to the same admin client so the test still exercises the real RPC end-to-end (not a stub), same rationale as the pre-existing `.from()` passthrough. This is the only test file needed fixing — every other consumer of `getProjectBoardTasks` (checked via `grep -rl getProjectBoardTasks tests/`) either uses the real request-scoped Supabase client unmocked or already had/didn't need `.rpc`, and all of them pass.

## Out-of-scope work needed
None identified. The RPC only replaces the four queries this feature was scoped to consolidate; no other query in `lib/queries/tasks.ts` (list/dashboard views) was touched, per the spec's "Files (approximate)" scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `security invoker` over `security definer` with a manual membership re-check. The spec allowed either ("must be SECURITY INVOKER, or if SECURITY DEFINER, must re-assert workspace membership internally"). Since this RPC is pure SELECT (no writes needing an atomic multi-statement transaction, unlike the timer RPCs cited in the spec as the DEFINER-hardening precedent), invoker is strictly simpler and safer — it can't accidentally become an RLS bypass because it never runs with elevated privileges in the first place. This also matches the project's own existing dashboard-aggregate RPCs (`get_priority_counts`/`get_status_counts`/`get_overdue_count`), keeping the RPC style consistent across the codebase.

## Notes for the next worker
- The new RPC lives in `supabase/migrations/20260819110000_rpc_project_board_tasks.sql` and has already been pushed to the linked project (qcipqonnqajmazdbysow) via `supabase db push --linked --yes` — no further migration action needed.
- If a future feature needs to add another per-task aggregate to the board card (e.g. comment counts), extend this RPC with one more `left join lateral` rather than adding a fifth whole-project TypeScript query — that's exactly the pattern this feature was created to eliminate.
- No MCP tools were used for this feature; schema changes went through the Supabase CLI (`supabase db push --linked`) per `mcp-registry.md`'s stated primary path, and the Supabase MCP server itself is optional/pending-approval in this mission per that same registry file.
