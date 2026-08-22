# Handoff: F168 — project-level estimate totals

## Status
COMPLETE

## Assertions covered
AS-303: PASS — `get_project_time_totals` now returns `estimate_minutes` (sum of `tasks.estimate_minutes` for the project's non-deleted tasks), and the project header (`app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx`) renders it alongside the existing logged/billable total ("Xh logged (Yh billable) of Zh estimated"); verified by `tests/integration/project-time-totals.test.ts`'s `test AS-303: sums the project's task estimates alongside the logged time totals` against the real linked Supabase project.
AS-304: PASS — the estimate sum is computed with `t2.deleted_at is null`, the same convention the RPC already used for AS-174's logged-time exclusion; verified by `tests/integration/project-time-totals.test.ts`'s combined `AS-174 / AS-304` test, which soft-deletes a task carrying a 200-minute estimate and asserts the RPC's `estimate_minutes` drops from 320 to 120 (only the kept task's estimate remains) in the same assertion that also re-checks the existing AS-174 logged-time drop.

## Files changed
supabase/migrations/20260822080000_rpc_project_time_totals_estimate.sql (new)
lib/queries/time-entries.ts
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx
lib/supabase/database.types.ts
tests/integration/project-time-totals.test.ts

## Commands run
`supabase migration list --linked` (0 — connectivity fine, all prior migrations already applied remotely)
`supabase db push --linked` (0 — new migration `20260822080000_rpc_project_time_totals_estimate.sql` applied)
`npm run test -- tests/integration/project-time-totals.test.ts` (0 — 3/3 passed: AS-172, AS-303, combined AS-174/AS-304)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 4 pre-existing warnings in files this feature did not touch: lib/actions/tasks.ts, lib/queries/search.ts, tests/unit/invite-member-pagination.test.ts)
`npm run test` (full suite — 1008 passed / 7 failed / 143 skipped across 175 files; every failure is pre-existing and unrelated to this feature: 6 are `AuthApiError: Request rate limit reached` (429) from concurrent workers hammering the same Supabase project's Auth Admin API — the same intermittent condition F166/F167's handoffs already documented — and 1 is a flaky perf-budget timing assertion (`AS-156`, `tests/integration/perf-budget.test.ts`, 560ms vs 500ms budget) unrelated to any file this feature touches. None of the 7 failures are in `project-time-totals.test.ts`, `time-entries.ts`, the new migration, or `layout.tsx`.)

## Decisions made
- Extended the existing `get_project_time_totals` RPC in place rather than adding a second RPC, per the spec's explicit clarified answer ("Extend the existing RPC rather than adding a second one that scans the same rows").
- Used `drop function if exists ... ; create function ...` instead of `create or replace function`, because the OUT-parameter shape changes (a third column, `estimate_minutes`, is added) — Postgres refuses `create or replace` when the return type shape changes. This matches the pattern this session's F167 follow-up and F161 already used for the same reason (noted in the feature brief).
- **AS-304 scope decision (the key judgment call):** the estimate sum is filtered on `t2.deleted_at is null` (individual soft-deleted tasks excluded) but deliberately does **not** filter on the project itself being non-archived. This directly follows F144's own documented precedent for this exact RPC: F144's migration (`20260822010000_active_project_tasks_view_and_time_report_fix.sql`) explicitly audited `get_project_time_totals` and stated it was "intentionally NOT touched" because it is scoped by a single `p_project_id` — a project viewing its own data on its own detail page, not a cross-project workspace aggregate — and that "whether an archived project's own detail page still shows its own historical time/board data is outside AS-254's... wording." AS-304's own wording is "totals exclude soft-deleted tasks" (not "archived projects"), so the estimate sum follows the exact same task-level-only exclusion the billable/non-billable sums already use, with no project-archived filter added. This is consistent, not a new inconsistency: an archived project's own header, when viewed directly, still shows its own real historical estimate and logged totals — exactly as it already did for billable/non-billable minutes before this feature.
- Computed the estimate sum as an independent scalar subquery (`select sum(t2.estimate_minutes) from tasks t2 where t2.project_id = p_project_id and t2.deleted_at is null`) rather than adding it to the main `time_entries` join's aggregate. A task with an estimate but zero logged time entries would never appear in the `time_entries te join tasks t` result set, so summing `estimate_minutes` from that join would silently undercount any task with no time logged yet — the independent subquery correctly counts every non-deleted task's estimate regardless of whether it has any time entries.
- Extended the existing F114 integration test file (`tests/integration/project-time-totals.test.ts`) in place, adding `estimate_minutes: 120` / `estimate_minutes: 200` to the two already-seeded tasks and two new assertions, rather than creating a parallel test file, since it exercises the exact same RPC and the same seeded fixture/teardown already covers the shared task setup.
- Rendered the estimate total inline in the existing header stat line ("Xh logged (Yh billable) of Zh estimated") rather than a separate stat block, keeping the change minimal and matching the clarified spec's "render alongside the existing billable/non-billable totals" instruction; the estimate clause only appears when `estimateMinutes > 0`, and the whole line's visibility condition was widened to `totalMinutes > 0 || estimateMinutes > 0` so a project with an estimate but no logged time yet still surfaces it (satisfying AS-303's "summed estimates against summed logged time" even at zero logged minutes).

## Out-of-scope work needed
- No dedicated UI to edit an estimate at the project level exists (F166/F167 already flagged the per-task estimate edit control as a separate follow-up); this feature only renders the pre-existing RPC's project-level sum, it doesn't add new editing surfaces.
- The header's estimate/logged phrasing is a minimal inline addition, not a redesigned stat block (e.g. no progress bar at the project level, unlike F167's per-task `TimeTracking` progress bar). If a richer project-level progress visualization is wanted, that's a new feature — out of scope here, since the spec only asked to "render alongside the existing... totals."

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose not to filter the estimate sum on the project's own archived state, following F144's explicit precedent reasoning for this exact RPC (documented above in Decisions made) rather than re-litigating that scope question — AS-304's wording matches the task-level-only exclusion already established for this RPC's other two columns.

## Notes for the next worker
- MCP: none required — this feature only needed the Supabase CLI (`supabase migration list --linked`, `supabase db push --linked`) against the linked project, not the Supabase MCP server, since no live schema introspection was needed beyond what the existing migration files already documented.
- If a future feature adds a project-archived exclusion to workspace-wide aggregates that happen to also touch `get_project_time_totals`'s columns, re-read F144's and this handoff's reasoning first — the single-project-detail-page scope is a deliberate, twice-now-confirmed exception to the cross-project archived-exclusion sweep, not an oversight.
