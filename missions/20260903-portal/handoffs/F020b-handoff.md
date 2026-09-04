# Handoff: F020b — projects guard inversion (M4-scrutiny B2)

## Status
COMPLETE

## Assertions covered
AS-040: PASS — `tests/integration/f020b-projects-allowlist-guard.test.ts` (13 tests) plus the pre-existing `tests/integration/f020-metrics-snapshots-improvements-baseline-freeze.test.ts` (still passing) prove: a client/viewer cannot unfreeze `baseline_frozen_at` (direct PATCH, both UPDATE and INSERT paths), a writer/member/owner can freeze and unfreeze, a writer cannot delete a baseline-carrying `project_metrics` row while its project is frozen, a writer cannot flip `direction` on a frozen metric (but can on an unfrozen one), unrelated columns (`client_visible`) stay editable on a frozen metric, and the self-maintaining allow-list rejects a throwaway column added to `projects` inside a rolled-back transaction with no edit to the guard function.

## Files changed
supabase/migrations/20261017010000_f020b_projects_allowlist_guard.sql
tests/integration/f020b-projects-allowlist-guard.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20261017010000_f020b_projects_allowlist_guard.sql` (0)
`npm run db:gen-types` (0, no diff — no new columns, only functions/triggers changed)
`npx vitest run tests/integration/f020b-projects-allowlist-guard.test.ts tests/integration/f006k-projects-column-role-gate.test.ts tests/integration/f020-metrics-snapshots-improvements-baseline-freeze.test.ts` (0, 52 tests passed)
`npx vitest run tests/integration/f021b-hours-period-scoping.test.ts` (0, 5 tests passed)
`npx tsc --noEmit` (0)
`npx eslint tests/integration/f020b-projects-allowlist-guard.test.ts supabase/migrations/20261017010000_f020b_projects_allowlist_guard.sql` (0, only an expected "no matching configuration" warning on the .sql path)

## Decisions made
- Inverted `enforce_project_portal_and_launch_field_role` (F006k, 20260919010000) into `enforce_projects_field_role_allowlist`, ported directly from F016j's `client_requests` technique (grep-verified at `supabase/migrations/20261008010000_f016j_client_requests_allowlist_guard.sql`: `pg_attrdef`/`to_jsonb` diff against a self-built default row at INSERT, against `OLD` at UPDATE). Kept F006k's two existing role bars (owner/admin for portal/visibility-class fields, writer for ordinary management fields) rather than flattening them, matching F006k's own header rationale (grep-verified at `20260919010000_projects_portal_launch_role_gate.sql`).
- Classified every column of `projects` (grep-verified via `create table if not exists projects` at `20260818004413_create_projects.sql` plus every subsequent `alter table projects add column` across the repo) into exactly one of four tiers: IDENTITY (never diffed: id/workspace_id/created_at/updated_at/created_by), MEMBER (name/description/start_date/end_date — no role check, AS-029), WRITER (target_launch_date/launch_confidence/launch_note/warranty_until/warranty_terms/baseline_frozen_at — role not in viewer/client), OWNER_ADMIN (portal_enabled/portal_enabled_at/visibility/deleted_at/archived_by — role in owner/admin). `baseline_frozen_at` was placed in WRITER, matching F020's own migration header ("goes through the ordinary team UPDATE path ... same as any other single-column project setting write in this schema", grep-verified at `20261013010000`, comment block before section 0).
- `visibility`, `deleted_at` and `archived_by` were folded into the new allow-list's OWNER_ADMIN tier even though they already have their own separate enforcement (`enforce_project_visibility_change_role` trigger, 20260821140526; `archiveProject`'s application-level admin/owner check, `lib/actions/projects.ts:213`). This is required, not optional defense-in-depth: since the new trigger's default branch rejects ANY change to a column not named in one of the three named tiers, omitting these three columns entirely would have broken legitimate owner/admin visibility changes and archiving through any future direct-PostgREST path. Left `enforce_project_visibility_change_role` itself untouched, per F006k's own precedent ("not this feature's scope to touch it").
- Extended the trigger to `BEFORE INSERT OR UPDATE` (F016f's own lesson, grep-verified at `20261005010000_f016f_insert_hole_and_reverts.sql`) because `projects_insert_active_members` (20260818004709) also has no role restriction — a client could otherwise `POST /rest/v1/projects` with `portal_enabled: true` and skip the UPDATE guard entirely.
- Extended `project_metrics.prevent_frozen_baseline_update` (F020, 20261013010000) BY NAME to also guard `direction`, per that migration's own established convention ("guard BY NAME, not the whole row").
- Added a `BEFORE DELETE` trigger (reusing the same `prevent_frozen_baseline_update` function, TG_OP branch) blocking deletion of a `project_metrics` row that carries a baseline while its project is frozen. This closes the delete-then-reinsert hole M4-scrutiny B2 named explicitly (item 2) and that the feature spec's DoD lists as a required test ("Tests calling PostgREST directly ... for: unfreezing, delete-then-reinsert, and editing direction"). A metric with no baseline can still be freely deleted even on a frozen project (a metric added after freeze that was never part of "the before").
- Did not touch `project_metrics`'s RLS policies (`project_metrics_delete_team`/`_insert_team`, still `is_project_workspace_writer`-gated, unchanged) — the fix lives entirely in the trigger, matching how `prevent_frozen_baseline_update` already worked for UPDATE.

## Out-of-scope work needed
- M4-scrutiny B1 (hours figures mix budget periods) and B3 (pre-baseline snapshot rendered as an improvement) are separate blockers in the same milestone, explicitly out of this feature's scope (F020b's own spec only addresses B2/AS-040). Both need their own features.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No clarification file exists for F020b (this is an orchestrator-opened M4-scrutiny remediation feature, not a tasked one). Resolved the "which bar for baseline_frozen_at" ambiguity from F020's own migration header text (quoted above) rather than defaulting to the tighter owner/admin bar the freeze mechanism's severity might otherwise suggest — freezing/unfreezing is described there as an ordinary team UPDATE, and the DoD's own primary test only requires client/viewer rejection, not member rejection.
AUTONOMOUS_DECISION: Classified `visibility`/`deleted_at`/`archived_by` into the new guard's OWNER_ADMIN tier (see Decisions made) since the inversion to an allow-list requires every column to be classified somewhere or it becomes unwritable by anyone; this was not explicit in the feature spec but is a structural necessity of "invert to an allow-list" as instructed.

## Notes for the next worker
- The self-maintaining regression test (`describe.skipIf(!haveManagementApi)`) requires `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` in `.env`; both are present in this environment and the test ran (not skipped).
- No MCP tools used — Supabase MCP is not authorised for this mission; migrations applied via `npm run db:apply` (CLI/Management API script), matching every prior worker in this mission.
