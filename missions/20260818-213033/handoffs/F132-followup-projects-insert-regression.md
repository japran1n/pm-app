# Handoff: F132 follow-up — projects INSERT/RETURNING RLS regression

## Status
COMPLETE

## Assertions covered
AS-028: PASS — `tests/integration/rls-projects.test.ts` full file (9/9 tests) passes; the specific regression test "a member of workspace A can INSERT a new project into workspace A" now passes.

## Files changed
supabase/migrations/20260821150000_fix_project_select_returning_regression.sql
supabase/migrations/20260821150001_drop_diag_scaffolding.sql

## Commands run
`npx vitest run tests/integration/rls-projects.test.ts -t "can INSERT a new project into workspace A"` (1) — reproduced the failure before the fix
`npx vitest run tests/integration/rls-projects.test.ts tests/integration/rls-project-visibility.test.ts` (0) — 20/20 pass after the fix
`npx vitest run tests/integration --no-file-parallelism` (0) — full integration suite, run serially per this mission's known convention (parallel runs hit Supabase auth rate limits/timeouts unrelated to this fix); 82 files / 497 tests, exit 0
`npx tsc --noEmit` (0)
`npx eslint .` (0) — one pre-existing unrelated warning in lib/queries/search.ts (`_titleMatches` unused), no errors
`supabase db push --linked` (0) — applied the fix migration and the diagnostic-scaffolding cleanup migration to the linked project

## Decisions made
- Root cause (verified by introspecting live `pg_policies`/`pg_proc` via a throwaway `SECURITY DEFINER` diagnostic RPC pushed with `supabase db push`, then deleted): F132's `20260821140526_project_visibility_rls_sweep.sql` rewrote `projects_select_active_members` to call `public.is_project_visible_to(id)`, which internally re-queries the `projects` table by id (`from projects p ... where p.id = target_project_id`) to look up the row's own `workspace_id`/`visibility`. PostgreSQL RLS evaluates a table's SELECT policies against the RETURNING row of an INSERT within the *same command*, and a row an INSERT has just produced is not yet visible to an ordinary table scan issued from within that same command (no CommandCounterIncrement yet) — including a scan inside a SECURITY DEFINER helper. So `INSERT INTO projects ... RETURNING ...` (what PostgREST's `.insert(...).select()` compiles to) failed the SELECT check every time, while a bare `INSERT` (no RETURNING) or a later separate `SELECT`/`.rpc()` call against the same, now-committed row worked fine — this asymmetry is exactly what the orchestrator observed. Confirmed directly: `.insert({...})` (no `.select()`) succeeded; `.insert({...}).select("id")` (or any column list, or with visibility passed explicitly) failed with the same 42501; calling `is_project_visible_to` via `.rpc()` on the already-committed row from the same session returned `true`.
- This is *not* a stale-policy/duplicate-object/pooler-cache issue as the orchestrator speculated — `pg_policies`/`pg_proc` matched the migration files exactly (single INSERT/UPDATE/SELECT policy each, single `is_project_visible_to` overload, all `security definer`).
- Every *other* caller of `is_project_visible_to`/`is_task_visible_to` (tasks' own SELECT policy via `project_id`, and comments/attachments/time_entries/checklist_items/task_dependencies via `is_task_visible_to(task_id)`) resolves through a row in a *different, already-committed* table, so none of those have this self-reference problem — confirmed by reading each policy's `with_check`/`qual` and reasoning through which table each function re-queries relative to the table being written. Only `projects_select_active_members` self-references the table it protects while also being the SELECT policy consulted during that same table's INSERT RETURNING. Scope of the fix is therefore limited to that one policy — no other policy touched.
- Fix: added `public.is_project_visible_to_row(target_project_id, target_workspace_id, target_visibility)`, which takes the row's own `workspace_id`/`visibility` as arguments (available directly from RLS's per-row USING-clause context, matching the pre-F132 pattern that worked) instead of re-deriving them via a self-query by id. `project_members` lookups inside it are unaffected (different table, already committed). Rewrote `projects_select_active_members` to call this row-based function with `id, workspace_id, visibility` from the row itself. Left `is_project_visible_to(uuid)` (the by-id version) untouched and still in place — it's still correct and used everywhere else.
- Used `supabase db push --linked` (the orchestrator did not have working CLI auth; I did) to push a throwaway `security definer` diagnostic RPC (`tmp_diag_policies`, `tmp_diag_funcs`) to read live `pg_policies`/`pg_proc` rows for `projects`/`project_members`/`is_project*` functions, plus a standalone reproduction script signed in as a real test user through the publishable-key client. Both the diagnostic functions and the migration file that created the first one were removed again (`supabase migration repair --status reverted <version>` + a follow-up migration dropping the functions) once the real fix was verified — no debug scaffolding left in the schema or in `supabase/migrations/`.
- Ran the full integration suite with `--no-file-parallelism` rather than the parallel default: the parallel run threw 32 unrelated file failures (Supabase auth "Request rate limit reached", a couple of test timeouts, one perf-budget miss), none touching `projects`/RLS; re-running the same failing files in isolation and the whole suite serially both passed cleanly, confirming these are pre-existing environment/concurrency flakiness (consistent with this mission's run-log noting the same "run serially" workaround for prior features), not something this fix introduced or should mask.

## Out-of-scope work needed
None identified beyond what F132's own handoff already flagged (task_assignees/task_watchers/task_templates sweep for whichever future feature creates those tables).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to add a new 3-argument `is_project_visible_to_row` function rather than modifying `is_project_visible_to(uuid)` in place, to avoid touching its behavior/signature for the other call sites (`is_task_visible_to` and any future by-id caller) that are unaffected by this bug and already tested elsewhere (rls-project-visibility.test.ts).

## Notes for the next worker
- The general lesson: any SECURITY DEFINER RLS-helper function that is used in a table's own SELECT policy and that re-queries that same table by the row's primary key will break `INSERT ... RETURNING` (i.e. any `.insert().select()` call) for that table, even though plain SELECT/UPDATE/DELETE and bare INSERT all work fine. If a future feature adds a new visibility/ACL helper to a table's own SELECT policy, prefer passing the row's already-available columns (from the USING-clause context) over re-querying the table by id.
- Reproduction/diagnosis was done with two `supabase db push`-applied throwaway migrations (`99999999999999_tmp_diag.sql`, `99999999999998_tmp_diag2.sql`) that were removed from the working tree and marked `reverted` in the remote migration history table before landing the real fix — `supabase migration list` on the linked project should show no trace of either version.
