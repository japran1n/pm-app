# Handoff: F024 — db schema projects

## Status
COMPLETE

## Assertions covered
(none — foundation/skeleton feature, per feature spec "Assertion IDs covered")

## Files changed
supabase/migrations/20260818004413_create_projects.sql
lib/supabase/database.types.ts (regenerated via `supabase gen types typescript`)

## Commands run
`supabase migration new create_projects` (0)
`supabase db push` (0) — applied `20260818004413_create_projects.sql` to linked project
`supabase gen types typescript --project-id <ref>` (0) — regenerated `lib/supabase/database.types.ts`
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run build` (0)
`npm run test` (0) — 20 files / 101 tests passed

## Decisions made
- **Established `set_updated_at()` as a shared trigger function** — no prior migration (F011 `workspaces`) created any `updated_at` column or trigger, so this is the first table needing one. Wrote it as a generic `plpgsql` function (`new.updated_at = now(); return new;`) rather than inlining logic per-table, per the spec's explicit suggestion to make it reusable for future tables (e.g. F027+ project-adjacent tables, tasks, comments).
- **CHECK constraint `projects_end_date_after_start_date`** written as `end_date is null or start_date is null or end_date >= start_date` so the constraint only fires when *both* dates are set, matching the spec's "when both are set" wording exactly (a project with only one of the two dates populated is not blocked).
- **`created_by` left nullable** with an FK to `auth.users(id)` and no `on delete` action override (matches `workspace_members.user_id`'s existing nullable-FK pattern in this repo) — per the spec's own rationale, in case the creating user is later deleted.
- **Index only on `workspace_id`** (`projects_workspace_id_idx`) — the only FK/lookup column this table's future RLS policy (F025) will join through, matching the `workspace_members_workspace_id_idx` precedent in F011's migration and the "Indexing" clarified-implementation answer.
- **No RLS policies written** — explicitly out of scope per the task instructions and F024's spec; deferred to F025.
- Followed F011's `workspaces` migration style exactly: snake_case columns, `not null default now()` for `created_at`, comments explaining non-obvious nullability choices placed after the table definition (not inline), `create index if not exists` naming convention `<table>_<column>_idx`.

## Out-of-scope work needed
- RLS policies on `projects` (workspace-membership join, soft-delete filtering `deleted_at IS NULL`) — F025.
- Server Action for project creation, including its own AS-035 (`end_date >= start_date`) validation duplicating this DB-level CHECK — F026.
- Any UI (`app/(workspace)/w/[workspaceSlug]/projects/...`) — later M3 features per tech-decisions.md file layout.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Named the shared trigger function `set_updated_at()` (unprefixed, public schema) since no naming convention for trigger functions existed yet in this repo; chose a short, generic, descriptive name intended for reuse by any future table with an `updated_at` column, per the spec's explicit invitation to establish this convention now.

## Notes for the next worker
- `set_updated_at()` now exists in the public schema (created via `create or replace function`, so it's idempotent/safe to reference or redefine later if needed). Any future migration adding an `updated_at timestamptz` column should add `before update ... execute function set_updated_at()` rather than reinventing this.
- `supabase db push` emitted a harmless NOTICE (`trigger "projects_set_updated_at" for relation "projects" does not exist, skipping`) from the migration's own `drop trigger if exists` guard — expected on a fresh table, not an error.
- `lib/supabase/database.types.ts` was regenerated in place (whole-file overwrite via CLI, not hand-edited) and now includes the `projects` table and its `projects_workspace_id_fkey` foreign key; verified via `grep` and via `npx tsc --noEmit` passing clean.
- MCP used: none — Supabase CLI (`supabase db push`, `supabase gen types typescript`) was used directly via Bash rather than the Supabase MCP server, consistent with how F011 applied its migration (no MCP tool access noted in that handoff either).
