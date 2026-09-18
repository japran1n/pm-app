-- Restrict UPDATE on workspace_members to only the two self-service columns.
-- The update policy (workspace_members_update_own_status_note) is correct but
-- without a column-level grant, authenticated users can PATCH role/workspace_id.
-- Pattern: same as 20260901010000_fix_profiles_tour_completed_at_column_grant.sql

revoke update on public.workspace_members from authenticated;
grant update (status_note, status_note_until) on public.workspace_members to authenticated;
-- Any future self-service column needs its own grant update (<col>) line here.
