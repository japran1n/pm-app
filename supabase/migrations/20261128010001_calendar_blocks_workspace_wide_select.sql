-- Widens calendar_blocks SELECT access to any active workspace member.
-- Previous policy included an is_project_visible_to() branch that made
-- cross-member visibility depend on project visibility. Discovery (2.1b)
-- and (2.2c) chose workspace-member-only: no private projects exist and
-- the Team Planner needs unrestricted cross-member read.
-- This WIDENS read access intentionally.

drop policy if exists "calendar_blocks_select_visible" on public.calendar_blocks;

create policy "calendar_blocks_select_visible"
  on public.calendar_blocks
  for select
  to authenticated
  using (
    is_active_workspace_member(workspace_id)
  );
