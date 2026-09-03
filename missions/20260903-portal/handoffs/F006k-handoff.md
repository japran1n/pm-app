# Handoff: F006k — A client can turn their own portal on

## Status
COMPLETE

## Assertions covered
AS-007: PASS — a client whose project has `portal_enabled = false` receives a 404 for that project's portal routes, and its rows are not returned by any portal query. This feature's specific slice: a `client` (or `viewer`) can no longer flip `portal_enabled`/`portal_enabled_at` on a project directly via PostgREST — verified with 14 new tests in `tests/integration/f006k-projects-column-role-gate.test.ts`, all passing against the live linked Supabase project.

## Files changed
supabase/migrations/20260919010000_projects_portal_launch_role_gate.sql (new)
tests/integration/f006k-projects-column-role-gate.test.ts (new)

## Commands run
`npm run db:apply -- supabase/migrations/20260919010000_projects_portal_launch_role_gate.sql` (0, applied and recorded on the live linked Supabase project)
`npm run migrations:check` (0, "No migration drift — all migrations present on remote.")
`npm run db:gen-types` (0, no diff to `lib/supabase/database.types.ts` — trigger/function-only change, no column/signature change)
`npx vitest run tests/integration/f006k-projects-column-role-gate.test.ts` (0, 14/14 passed)
`npx vitest run tests/integration/rls-projects.test.ts tests/integration/rls-project-visibility.test.ts tests/integration/edit-project.test.ts tests/integration/portal-phases-rls.test.ts tests/integration/archive-project.test.ts tests/integration/create-project.test.ts tests/integration/restore-project.test.ts tests/integration/project-members-ui-actions.test.ts tests/integration/f327-project-lead-column-management.test.ts` (0, 72/72 passed — side-effect verification: project editing/archiving/creation/restore, the pre-existing visibility trigger, and project-lead column management all still behave as before)
`npx vitest run tests/integration/f003-portal-shell.test.ts tests/integration/f005-portal-pages.test.ts tests/integration/client-role-rls.test.ts tests/integration/client-requests-rls.test.ts` (0, 44/44 passed — adjacent client/portal read-path suites, unaffected)
`npx tsc --noEmit` (0 errors, full repo)
`npx eslint supabase/migrations/20260919010000_projects_portal_launch_role_gate.sql tests/integration/f006k-projects-column-role-gate.test.ts` (0 errors — the `.sql` file only produces the expected "no matching configuration" warning)
`npm run lint` (0 errors, 20 pre-existing warnings — identical to this mission's own established baseline; none in any file this feature touched)

Full vitest suite deliberately NOT run, per instruction — only the tests relevant to this change plus tsc/eslint.

## Decisions made

**Mechanism: match the existing visibility trigger's shape, not RLS-policy narrowing.** `projects_update_active_members`'s USING/WITH CHECK apply to the whole row, not a single column — narrowing that policy by role would also block AS-029 (any active member editing name/description/dates), which the spec explicitly requires to survive. `enforce_project_visibility_change_role` (`20260821140526_project_visibility_rls_sweep.sql:229-256`) already solved the identical "some columns on this table need a stricter bar than the rest" problem for `visibility` with a `BEFORE UPDATE` trigger. New migration adds a second, separate `BEFORE UPDATE` trigger (`enforce_project_portal_and_launch_field_role` / `projects_enforce_portal_and_launch_field_role`) rather than folding into the existing one — same mechanism (a trigger), kept in its own function so this migration doesn't have to touch or re-verify the byte-identical body of a trigger another feature owns. Both triggers coexist and fire independently (verified: `pg_trigger` shows both `projects_enforce_visibility_change_role` and `projects_enforce_portal_and_launch_field_role` attached and enabled; the "visibility trigger still allows an owner to change visibility, coexisting with the new portal/launch trigger" test in the new suite proves no interference).

**Two role bars, deliberately not flattened to one (spec step 2):**
- `portal_enabled` / `portal_enabled_at` → `role in ('owner', 'admin')`. This decides what an external party (a client) can see at all — the same blast radius as `visibility`, which is already held to this exact bar by the pre-existing trigger. Verified by a dedicated test that an ordinary "writer" `member` (who legitimately passes every other write gate in this schema) is *still* rejected — proving the bar is deliberately stricter than "any writer," not accidentally uniform with the launch fields.
- `target_launch_date` / `launch_confidence` / `launch_note` → `role not in ('viewer', 'client')`. These are ordinary project-management fields (when does this ship, how confident are we), not a visibility gate. This is this schema's already-established "writer" bar — grepped and matched exactly against `public.is_project_workspace_writer`'s live body (`supabase/migrations/20260908010000_pin_pg_temp_on_client_visibility_predicates.sql:69-83`: `wm.role not in ('viewer', 'client')`), not invented fresh. Implemented inline (not by calling the helper function) to match `enforce_project_visibility_change_role`'s own inline-query shape exactly, per the spec's "match its shape" instruction — the helper takes a `project_id` and re-joins through `projects`, which is unnecessary complexity inside a trigger that already has `new.workspace_id` in hand.

**`search_path` pin.** `enforce_project_visibility_change_role` (the trigger being matched) predates the `pg_temp`-shadowing lesson and only sets `search_path = public`. This is a newly-authored SECURITY DEFINER function sitting on the same authorization boundary, so it pins `search_path = public, pg_temp`, per this schema's now-established convention for every SECURITY DEFINER function written since `20260908010000` (`20260909010000`, `20260918010000` both do the same). Not touching the older trigger's `search_path` — out of this feature's scope, and it isn't one of this mission's added columns' policies.

**`service_role` exemption.** Copied verbatim from `enforce_project_visibility_change_role`'s own comment/shape: `auth.role() = 'service_role'` (the admin client, `lib/supabase/admin.ts`) bypasses this trigger by design — it's this codebase's only privileged, RLS-bypassing write path, used for seed/fixture data and any server-side flow that has already re-verified authorization itself before calling the admin client.

## Column sweep (spec step 3) — every column this mission has added to a pre-existing table

| Column | Governing policy/trigger | Current role bar | Verdict |
|---|---|---|---|
| `projects.portal_enabled` | **NEW:** `projects_enforce_portal_and_launch_field_role` trigger (this migration) | `owner`/`admin` only | **FIXED HERE** — was ungated (any active workspace member via `projects_update_active_members`'s role-agnostic `is_active_workspace_member`) |
| `projects.portal_enabled_at` | same as above | `owner`/`admin` only | **FIXED HERE** |
| `projects.target_launch_date` | same trigger, separate branch | writer (`role not in ('viewer','client')`) | **FIXED HERE** — was ungated |
| `projects.launch_confidence` | same as above | writer | **FIXED HERE** |
| `projects.launch_note` | same as above | writer | **FIXED HERE** |
| `tasks.phase_id` | `tasks_update_active_members` (`20260821194500`, `public.is_project_workspace_writer`) | writer (`role not in ('viewer','guest')`, later redefined to `('viewer','client')` — client and viewer both excluded either way, grepped live: `20260908010000:69-83`) | **Correct as-is.** Ordinary task-organization field (which phase a task sits in); the writer bar this table already enforces for every other task column is the right bar — no visibility-critical meaning, matches spec's "ordinary project management... belongs with writers." Not touched. |
| `tasks.page_slug` | same policy | same writer bar | **Correct as-is**, same reasoning — determines a task's URL slug in the Pages view, not whether the client sees it at all (that's `tasks.client_visible`, a pre-existing, already-gated column this mission did not add). Not touched. |
| `tasks.page_order` | same policy | same writer bar | **Correct as-is**, same reasoning — pure ordering. Not touched. |
| `project_statuses.client_description` | `project_statuses_update_admin` (`20260829010000_fix_project_statuses_rls_lead_regression.sql`, `public.is_project_lead_or_workspace_admin`) | owner/admin **or an explicit project lead** | **Correct as-is** — already held to an even stricter, admin-equivalent bar (grepped live: the policy requires `is_project_visible_to(project_id) and is_project_lead_or_workspace_admin(project_id)`, and `client`/`viewer` satisfy neither branch). This is client-facing status copy, so the tight bar is appropriate; nothing to fix. |
| `project_statuses.client_bucket` | same policy as `client_description` (added by the same `20260911010000` migration, no separate write policy) | same owner/admin-or-lead bar | **Correct as-is**, same reasoning. |
| `task_types.system_key` | `task_types_write_admins` (`20260903040000_task_types.sql:44-64`, `for all`) | owner/admin only, no lead exception | **Correct as-is** — `system_key` decides which task type is treated as the "page" type for the entire Pages view (`getPortalPages`, F005b's own header comment); the tightest bar on the table (owner/admin, no lead carve-out unlike `project_statuses`) is appropriate for a column with that much leverage over what routes into the client portal at all. Nothing to fix. |
| `docs.client_visible` | N/A | N/A | **Column does not exist yet** — grepped `supabase/migrations/*.sql` for `create table.*docs` / `alter table docs`: only `20260904010000_docs_system.sql` exists, and it has no `client_visible` column. The spec names this column "when it lands" — it hasn't. Nothing to sweep; flagged for whichever future feature adds it to re-run this same question then. |

## Out-of-scope work needed

- `docs.client_visible` sweep, once a future feature actually adds that column — this handoff's table above should be the template for that check (name the governing write policy, state the role bar, justify or fix it).
- Not part of this feature, but observed while testing: a `client` cannot even `SELECT` (or therefore `UPDATE`) a `visibility: 'workspace'` project they have no `project_members` row for — `is_project_visible_to_row`'s role branch excludes `client`/`guest` from workspace-wide visibility entirely (`wm.role not in ('guest', 'client')`, pre-existing, not touched by this mission). This considerably narrows the real blast radius of the original defect (a client can only have reached `portal_enabled` on a project they already have an explicit `project_members` row for — typically "their own" project) but does not make the fix in this feature redundant: a client legitimately added to their own project could otherwise flip `portal_enabled` on it themselves before the agency is ready, and any `viewer` (not excluded from workspace-visibility) could do so on *any* workspace-visible project with zero project-level scoping at all. Both paths are closed by this migration. No follow-up needed — noted for the next worker's own mental model of this schema, not a defect.

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: Kept the new role-gate as a second, separate trigger/function rather than editing `enforce_project_visibility_change_role` in place. The spec's instruction ("match its shape... no reason for two different mechanisms guarding two sets of columns on one table") reads as "use the same *kind* of mechanism" (a `BEFORE UPDATE` trigger, not a third invented approach), not "must be the literal same function" — editing another feature's existing, already-tested trigger body to bolt on unrelated columns felt like a larger and riskier diff than the spec's 2-hour estimate implies, and Postgres supports multiple `BEFORE UPDATE` triggers on one table natively (both fire; order is name-alphabetical and doesn't matter here since the two functions touch disjoint column sets). Verified via `pg_trigger` that both triggers are attached and enabled, and via a dedicated test that they don't interfere with each other.

AUTONOMOUS_DECISION: Picked migration timestamp `20260919010000` — the next free 14-digit prefix after the highest existing file in `supabase/migrations/` at the time (`20260918010000`, F006i's own remediation migration). Re-checked `ls supabase/migrations` immediately before writing the file and again immediately before `db:apply`; no collision.

## Notes for the next worker

- Migration file: `supabase/migrations/20260919010000_projects_portal_launch_role_gate.sql` — applied via `npm run db:apply` against the live linked Supabase project (Supabase MCP not authorised for this feature, per the task instructions; CLI/`npm run db:apply` is this mission's established convention).
- A real gotcha hit while writing the test fixture, worth flagging for whoever next writes a `client`-role direct-PostgREST test against `projects`: Postgres RLS requires a row to satisfy the table's `SELECT` policy before an `UPDATE` targeting it will match *at all*, independent of how permissive the `UPDATE` policy's own `USING` clause is. A `client` with no `project_members` row for a `visibility: 'workspace'` project gets a *silent* zero-row update (HTTP 204, `error: null`, nothing actually changes) — not an RLS error — because they can't see the row in the first place, not because the `UPDATE` policy rejected them. Cost real debugging time (see the three throwaway `node --env-file=.env -e "..."` probes against the live DB in this session's Bash history) before landing on adding the `project_members` row the same way `tests/integration/portal-phases-rls.test.ts` already does. Any future test asserting "role X is rejected by RLS" against `projects` needs to first confirm role X can *see* the row, or a false-negative "rejected" assertion is actually testing the wrong policy.
- If a future worker touches `enforce_project_visibility_change_role` (the older trigger) or renames/consolidates it with this feature's new trigger, re-run `tests/integration/f006k-projects-column-role-gate.test.ts` — it's the only regression coverage proving the two triggers coexist correctly.
