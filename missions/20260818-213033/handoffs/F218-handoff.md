# Handoff: F218 — db-schema-project-statuses

## Status
COMPLETE

## Assertions covered
AS-403: PASS — `tests/integration/status-backfill.test.ts` "AS-403: board columns are defined per project, not global" (project A gets an extra column, project B does not; distinct `project_statuses` rows per `project_id`) + "AS-403 negative: an outsider ... cannot read another workspace's project_statuses" (RLS via `is_project_visible_to`).
AS-407: PASS — `tests/integration/status-backfill.test.ts` "AS-407: a new project starts with the default four columns" (inserts a project through the same `projects` insert path the app uses, asserts the trigger-seeded `project_statuses` rows are exactly todo/in_progress/in_review/done with the right categories).
AS-408: PASS — `tests/integration/status-backfill.test.ts` "AS-408: existing tasks migrate to the default columns with status preserved exactly" (inserts a task per legacy status value, asserts `status_id` was populated by the sync trigger and joins back to a `project_statuses` row of the identical name) + "AS-408 regression: updating tasks.status keeps status_id in sync".

## Files changed
supabase/migrations/20260824010000_project_statuses.sql
lib/supabase/database.types.ts
tests/integration/status-backfill.test.ts
missions/20260818-213033/handoffs/F218-handoff.md

## Commands run
`supabase db push` (0) — applied 20260824010000_project_statuses.sql to the linked project qcipqonnqajmazdbysow
`supabase gen types typescript --linked` (0) — regenerated lib/supabase/database.types.ts
`npx vitest run tests/integration/status-backfill.test.ts` (0) — 5/5 passed
`npx tsc --noEmit` (0) — no errors
`npx eslint .` (0) — 0 errors, 2 pre-existing unrelated warnings (lib/queries/search.ts, tests/unit/invite-member-pagination.test.ts)
`npx vitest run` (regression slice: overdue-count-rpc, status-counts-rpc, board-columns-render, list-status-inline-edit, dashboard-rls-cross-workspace, dashboard-list-tasks-rls-cross-workspace, move-task-status, board-reload-persistence, dashboard-workspace-switch-refresh integration tests + board-column, board-realtime-subscription, dashboard-chart-colors, board-move-status-wiring, list-table-status-priority-colors, board-column-counts, list-table-bulk-selection unit tests) (0) — 16 files, 68/68 passed
`npm run test` (full suite, run twice) — 1747-1785/1815 passed both runs; all failures traced to documented infra noise (Supabase Auth "Request rate limit reached", one PG `57014 statement timeout` under load, one pre-existing `user-avatar.test.tsx`/`trash-list.test.tsx` "app router not mounted" issue unrelated to this feature) — none touch `project_statuses`, `tasks.status`, or `tasks.status_id`.

## Decisions made
- Seeded the default four columns via an `AFTER INSERT ON projects` trigger (`projects_seed_default_statuses` → `seed_default_project_statuses_on_insert` → `seed_default_project_statuses`) rather than application code in `lib/actions/projects.ts`, because I found **two independent project-insert paths with no shared application function**:
  1. `lib/actions/projects.ts` `createProject` — a plain admin-client `.insert()` into `projects`.
  2. `supabase/migrations/20260822190000_rpc_create_project_from_template.sql` `create_project_from_template` — a raw `insert into projects` inside PL/pgSQL, invoked from `lib/actions/templates.ts`.
  A trigger on `projects` itself is the only mechanism that covers both today and any future path (including test fixtures/seed scripts) without either caller needing to know `project_statuses` exists — matches Clarified implementation's "no new dependency, no second source of truth" instruction. Verified: `grep -rn "insert into projects"` across `supabase/migrations/` returns only the template RPC; the app-code path is `createProject`.
- Kept `tasks.status` (text) live and added `tasks.status_id` (nullable FK) plus a `BEFORE INSERT OR UPDATE ON tasks` trigger (`sync_task_status_and_status_id`) that derives whichever of `status`/`status_id` was NOT the one just written, from the other, using the `(project_id, name)` pair seeded by this migration. This means every existing reader/writer of `tasks.status` (untouched by this feature — F223's job) keeps working unmodified, while `status_id` stays populated and correct for the new `project_statuses` FK from day one, satisfying "existing tasks migrate to the default columns with their current status preserved exactly" without touching a single reader.
- Backfill ran inline in the same migration (`do $$ ... $$` seeding every existing project, followed by a bulk `update tasks set status_id = ...`), matching the "additive backfills run in the same migration" clarified answer, rather than a separate script.
- RLS: reused `public.is_project_visible_to(project_id)` verbatim (no new predicate), full select/insert/update/delete sweep on `project_statuses` since it is a brand-new table created after `20260821140526_project_visibility_rls_sweep.sql` ran — matches that migration's documented style and this feature's explicit instruction not to copy-paste visibility logic.
- `seed_default_project_statuses` and the two trigger functions are SECURITY DEFINER, not granted to `authenticated`/`anon` (only `service_role`, and triggers run under the definer regardless) — mirrors `create_project_from_template`'s "not directly callable, only via the app's write path" pattern.
- Default four columns use `on conflict (project_id, name) do nothing` in the seed helper so the trigger is idempotent/re-runnable (relevant for the inline backfill calling it for pre-existing projects, and safe if ever re-applied).
- Position values (1000/2000/3000/4000) follow the same 1000-step convention already used elsewhere in this codebase (e.g. `create_project_from_template`'s `v_position := v_position + 1000`).

## Out-of-scope work needed
- AS-404–AS-406, AS-409–AS-417 (admin CRUD on columns, drag-to-set-status wiring, column-based progress/overdue/dependency completeness, list/dashboard/search readers, realtime column-change broadcast, non-admin restriction, zero-column guard, column-order persistence) are explicitly F219 onward per the milestone's feature breakdown — not touched here. This feature only adds the schema, RLS, seeding, and backfill.
- F223 (migrating every existing board/list/filter/RPC/realtime reader off `tasks.status` onto `project_statuses`/`status_id`) is unstarted; `tasks.status` remains the column of record for now, exactly as this feature's spec requires.
- F270 (dedicated cleanup feature) is the place `tasks.status` and the sync trigger get dropped once F223 lands — not this feature.
- Noticed (not fixed, out of scope): `tests/unit/trash-list.test.tsx` and `tests/unit/user-avatar.test.tsx` fail independently of this migration with "invariant expected app router to be mounted" / `cookies()` called outside request scope — pre-existing test-harness issues unrelated to project_statuses, flagged here only so a future worker doesn't waste time re-diagnosing them as a regression from this change.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose a DB trigger over touching `lib/actions/projects.ts`/`lib/actions/templates.ts` application code for AS-407, because the spec instructed "cover EVERY creation path" and the two existing paths share zero application-layer code — a trigger is the only single point that guarantees both (and future paths) stay covered without adding a second call-site to remember to update.
AUTONOMOUS_DECISION: Chose a bidirectional sync trigger (rather than only backfilling once and leaving `status_id` to go stale on future updates) so that AS-408's "preserved exactly" guarantee holds not just at migration time but for every task created/updated afterward while both columns coexist — needed because F223 has not migrated writers yet, so `tasks.status`-only writes are still the norm.
AUTONOMOUS_DECISION: Named the FK column `tasks.status_id` and the table `project_statuses` exactly as given in the feature spec's Draft scope, rather than inventing alternate names.

## Notes for the next worker
- Live schema was verified via `supabase gen types typescript --linked` (direct Postgres path through the CLI, not the PostgREST/Management API, per the "known infra conditions" note) — `project_statuses`, `tasks.status_id`, and the `seed_default_project_statuses` RPC signature all appear correctly in the regenerated `lib/supabase/database.types.ts`.
- Supabase MCP was not needed beyond what the CLI already confirmed (project `qcipqonnqajmazdbysow` ACTIVE_HEALTHY per `mcp-registry.md`); no MCP tool calls were made for this feature since the CLI path is the registry's documented primary path and worked cleanly.
- If a future worker adds MORE project-creation paths (e.g. a "duplicate project" feature), no action is needed on their part for default-column seeding — the `AFTER INSERT ON projects` trigger fires automatically for any insert into `projects`, from any caller.
- The full-suite run is genuinely noisy right now under the linked project's load (auth rate limiting + occasional `57014` statement timeouts) — re-run any single failing file alone before treating it as a regression, per this feature's run instructions. I did this for `status-backfill.test.ts` (passed cleanly, 5/5) and the named regression slice (passed cleanly, 68/68, run once as a batch outside the noisy full-suite run).
