# Handoff: F018 — Team UI: budget, work category, and the team burn view

## Status
COMPLETE

## Assertions covered
AS-033: PASS — `project_budgets` CRUD (`lib/actions/project-budgets.ts`) gated by `withAuthz`'s `requireWrite`/`requireVisibility` (which resolve to `canWrite`, excluding viewer/client). Live integration test `test_AS_033_a_viewer_cannot_create_a_budget` / `test_AS_033_a_client_cannot_create_a_budget` insert directly via each role's own RLS-scoped session and assert the write is rejected (RLS is the actual enforcement boundary, per F017's own `project_budgets_insert_team` policy). A team member's create/edit/delete/spend-preview path is exercised by the Budget settings panel (`components/project/budget-panel.tsx`, `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/budget/page.tsx`).
AS-038: PASS — the team hours view (`/w/[workspaceSlug]/projects/[projectId]/hours`) renders by-person, by-category, and per-entry breakdowns from `getProjectHoursTeam`, with every billable row/bucket labelled "client sees this" (billable IS what `project_hours_client` returns, per F017's own RPC — no second, possibly-diverging definition of "client-visible" invented here). "Every category shown has a stated value": each category bucket, including "Uncategorised", carries its own minutes total, never a colour or icon alone. Unit tests (`tests/unit/f018-time-tracking-category-render.test.tsx`, 8/8 passing) cover the category select's default-from-tags behaviour and the existing-null-category side-effect check; the live sweep test doubles as AS-038's supporting infrastructure check (it depends on `time_entries.billable`/`work_category` reads matching what the view renders).

## Files changed
supabase/migrations/20261012010000_f018_budget_threshold_sweep.sql
lib/validation/time-entries.ts
lib/actions/time-entries.ts
lib/validation/project-budgets.ts
lib/actions/project-budgets.ts
lib/queries/project-budgets.ts
components/project/budget-panel.tsx
components/project/team-hours-view.tsx
components/project/project-settings-nav.tsx
components/project-tabs.tsx
components/task/time-tracking.tsx
components/task/task-detail-sheet.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/budget/page.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/hours/page.tsx
lib/supabase/database.types.ts (regenerated)
tests/integration/f018-budget-threshold-sweep.test.ts
tests/unit/f018-time-tracking-category-render.test.tsx

## Commands run
`npm run db:apply -- supabase/migrations/20261012010000_f018_budget_threshold_sweep.sql` (0 — note: the file was first written as `20261011010000_...` and collided with an already-applied `20261011010000_f016l_gated_function_oids_rls.sql`; renamed to `20261012010000` before applying, see Decisions made)
`npm run db:gen-types` (0)
`npm run migrations:check` (0, no drift)
`npx vitest run tests/integration/f018-budget-threshold-sweep.test.ts` (0, 3/3 passing)
`npx vitest run tests/unit/f018-time-tracking-category-render.test.tsx` (0, 8/8 passing)
`npx vitest run tests/integration/f017-hours-migration.test.ts tests/integration/f013-deliverables-review-and-sweep.test.ts tests/integration/f016i-anon-execute-catalog.test.ts` (0, 34/34 passing — no regression from the `notifications` schema change)
`npx vitest run tests/integration/rls-time-entries.test.ts` (0, 9/9 passing — no regression from `work_category`/manual-category-action changes)
`npx tsc --noEmit` (0)
`npx eslint <all files changed/added above>` (0 errors; one warning fixed — unused `budgetId` in the new test file)

## Decisions made
- **Filename collision, resolved before apply**: the migration was first authored as `20261011010000_f018_budget_threshold_sweep.sql`; `npm run db:apply` reported it "already applied" because `20261011010000_f016l_gated_function_oids_rls.sql` (a different feature) already owns that 14-digit version prefix. Renamed to `20261012010000_f018_budget_threshold_sweep.sql` (confirmed via `ls supabase/migrations | grep 20261011`/`20261012` — no other file uses that prefix) before applying. Recorded here since the file's own header comments still describe the mechanism, not this specific collision.
- **Sweep idempotency key includes `user_id`**: a project can have more than one `project_members.project_role = 'lead'`, and each is an independent notification recipient — the dedup unique index (`notifications_budget_threshold_once_idx`) is `(project_id, user_id, kind, payload->>'period_start')`, not `(project_id, kind, period_start)` alone, so two leads on the same project each get their own notification and neither blocks the other's insert.
- **"The project's PM" = `project_members.project_role = 'lead'`**: this schema has no dedicated PM/owner column on `projects` (checked: `create table if not exists projects`, `supabase/migrations/20260818004413_create_projects.sql`, has no such column) — `project_members.project_role = 'lead'` (`20260821140520_project_members.sql`) is the one place this schema already distinguishes a project lead from a plain member. A project with no explicit lead row is skipped entirely for threshold notifications (nowhere sanctioned to send it; falling back to workspace owner/admin would be a second, silent definition of "PM"). AUTONOMOUS_DECISION — see below.
- **"Spend" for threshold purposes = billable minutes only**: matches `project_hours_client`'s own definition of what counts against a budget (billable-only), not raw logged time including non-billable work. `sold_minutes` is sold, i.e. billable, hours.
- **Per-row exception handling in the sweep, from the start, not added after a failure**: `20260823120000_fix_overdue_sweep_orphaned_assignee.sql`'s own postmortem (an unhandled exception on one bad row rolled back the whole run, which then permanently starved the dedup gate that only inserts on success) is copied into `sweep_project_budget_thresholds` from day one — recipient membership is joined/checked before `create_notification` is called, and the call itself is wrapped in `begin ... exception when others then raise warning ... continue`, so one bad project can never take the rest of the daily run down with it. Cited by file and line in the migration's own header comment (`20260823120000_fix_overdue_sweep_orphaned_assignee.sql`).
- **`create_notification`'s own return row is captured and updated with `project_id`**, rather than a time-window guess (`created_at >= now() - interval`) — `create_notification` (`20260823020000`) `returns public.notifications` (one row), so `select * into v_notification from public.create_notification(...)` gives an exact row id to `update ... where id = v_notification.id`, with no race window. `create_notification`'s own signature is deliberately left untouched (no ninth `p_project_id` parameter added) since it's shared across every notification kind in this schema.
- **`setTimeEntryCategory` is a new, narrower action, not an extension of `editTimeEntry`**: `editTimeEntry` is author-only by explicit design (AS-169, `lib/actions/time-entries.ts`'s own doc comment: "not an admin/owner, not anyone else"). The spec's "editable in place from the team hours view" requirement needs a PM to fix someone else's uncategorised entries, which `editTimeEntry`'s author-only gate cannot allow without weakening AS-169 for every other field. `setTimeEntryCategory` writes only `work_category`, gated by `canWrite(role)` (excludes viewer/client) + `isProjectVisibleToCaller`, independent of who logged the entry.
- **Category default source is task tags, not a task "type" field**: this schema's `tasks` table (`20260818013434_create_tasks.sql`) has `title/description/status/priority/tags` but no `type` column — checked directly against that migration before writing `defaultCategoryFromTags`. A tag whose normalized (lowercased, spaces/hyphens → underscore) form matches a `work_category` enum value is used as the default; no match (or no tags) leaves the field unset rather than guessing. AUTONOMOUS_DECISION — see below.
- **"Already spent" preview is a live round trip, not client-side computation**: per this codebase's "client components never query Supabase directly" convention, `previewProjectBudgetSpent` (`lib/actions/project-budgets.ts`) is a `withAuthz`-gated read-only Server Action the budget form calls on blur of either period-date field, rather than passing every time entry down as a prop.
- **Team hours view's default window**: the current (or most recent) budget's own period if one exists, otherwise the last 30 days — an empty budget list is a valid state for AS-038 (a PM can read hours before ever setting up a budget).

## Out-of-scope work needed
- No email notification for the 80%/100% threshold — matches this feature's own spec ("This is the one place where the missing email hurts least... an in-app notification... is checked, because the PM is in the app anyway"), not a gap.
- The team hours view has no date-range picker yet — it always shows the current/most-recent budget period (or last 30 days with no budget). A follow-up could add an explicit period selector; not in this feature's own scope list (`/hours` — "the full picture", no picker named).
- `setTimeEntryCategory`'s permission is "any team writer on the project", not scoped further to leads only — the spec's own text ("editable in place from the team hours view") does not name a narrower role, and `canWrite` is this codebase's standing floor for any write in a project settings-adjacent surface.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: "the project's PM" (the sweep's notification recipient) = `project_members.project_role = 'lead'`; a project with no lead row is skipped for that project's threshold notifications rather than falling back to a workspace owner/admin. See "Decisions made" above for the reasoning.
AUTONOMOUS_DECISION: the category select's default source is a normalized match against the task's own `tags` array (no `type` column exists on `tasks` in this schema); no match leaves the category unset. See "Decisions made" above.

## Notes for the next worker
- No MCP tools used — the Supabase MCP is not authorised per this feature's own instructions; all migration apply/gen-types went through the CLI scripts (`npm run db:apply`, `npm run db:gen-types`), matching F017's own established convention.
- If you need to add another daily/hourly pg_cron sweep in this schema, read this migration's own header comment first — it names both precedent sweeps (`20260823050000` for the "nagged hourly" failure mode this feature's dedup key avoids, `20260823120000` for the "one bad row rolled back everything and caused permanent silence" failure mode this feature's per-row exception handling avoids) with file/line grep confirmation, not just by description.
- `time_entries.work_category` (added by F017) is now writable through three paths: `logTimeEntry` (new entry, optional), `editTimeEntry` (author-only, any field including category), and `setTimeEntryCategory` (any team writer, category only, F018's own addition for the team hours view). All three funnel through the same `workCategorySchema` (`lib/validation/time-entries.ts`) so the enum can't drift between them.
