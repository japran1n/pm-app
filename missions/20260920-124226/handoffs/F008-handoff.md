# Handoff: F008 — migration widen block select

## Status
COMPLETE

## Assertions covered
AS-025: UNTESTED — Migration SQL written to grant SELECT to any active workspace member; not applied (F010 applies it), so no live DB test run. Logic verified by reading policy definition.
AS-026: UNTESTED — Same policy removes the is_project_visible_to() branch entirely, so project-visibility no longer gates block read; verified by code inspection only, not applied.
AS-027: UNTESTED — This is a read-access (RLS) change only; it does not touch how the UI renders another member's block title, so real-title rendering must already exist or be handled by a separate feature. No UI/API code was touched per this feature's scope (migration-only).
AS-028: UNTESTED — Policy still requires is_active_workspace_member(workspace_id), which excludes non-members; verified by code inspection only, not applied.

## Files changed
supabase/migrations/20260920113500_calendar_blocks_workspace_wide_select.sql

## Commands run
`grep -rl "calendar_blocks_select_visible|is_active_workspace_member" supabase/migrations` (0) — confirmed existing policy text and that is_active_workspace_member is a widely-used existing function (defined/used across many prior migrations, e.g. 20260817222822_rls_workspaces.sql)
`git add ... && git commit ...` (0)

## Decisions made
- Preserved `to authenticated` clause from the original policy definition (present in 20261107010000_calendar_blocks.sql) even though the spec's SQL snippet omitted it, since dropping it would unintentionally also grant anon role access — an unrelated widening not requested by the spec.
- Used unquoted `is_active_workspace_member(workspace_id)` per spec-provided SQL; confirmed the function is schema-resolvable the same way it is in the original calendar_blocks policy (no explicit `public.` prefix was in the spec's snippet, function is in public schema and used unqualified elsewhere in the same style in some migrations — left as given to match spec text exactly).
- Timestamp chosen as 20260920113500 — later than the most recent 2026-09-20 migration (20260920020000) and safely earlier than all other existing migrations (next one is 20261004...), keeping it in the required time window and ahead of any not-yet-created F009 migration (F009 will need a later timestamp).
- Did NOT apply the migration to the live database — spec explicitly reserves that for F010. No Supabase MCP execute_sql/apply_migration calls were made; only local grep-based verification of the existing migration file was used to confirm current policy shape and function existence (equivalent read done via file inspection since the function/table already exist by definition of the migration file itself, no live schema introspection was necessary to write this file-only change).

## Out-of-scope work needed
- Applying this migration to the live Supabase project (assigned to F010).
- AS-027 (real title vs. placeholder rendering) may need UI/API verification once the RLS change is live — if the current UI already fetches and displays block titles for blocks the viewer could see, this assertion should pass once F010 applies the migration; if the UI currently substitutes a placeholder for blocks outside the viewer's own visibility, that would be separate application code, out of scope for this migration-only feature.
- F009 (drops task_id from calendar_blocks) must use a timestamp later than 20260920113500.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept `to authenticated` in the recreated policy (not present in the spec's literal SQL block) because the original policy had it and removing it would silently widen access to the anon role too, which is not what "widen to any active workspace member" means and is not supported by the clarification rationale.

## Notes for the next worker
- The full current policy set for calendar_blocks (insert/update/delete, left untouched) is visible in supabase/migrations/20261107010000_calendar_blocks.sql for reference.
- No Supabase MCP calls were made in this feature since the change is a static file write with no live-state verification needed (function `is_active_workspace_member` already exists and is used pervasively across the codebase's migration history, confirmed via grep rather than MCP).
- F010 should run `mcp__supabase__apply_migration` (or equivalent) to apply this file, then verify via `mcp__supabase__execute_sql` that a non-member is denied and an active member can read another member's block.
