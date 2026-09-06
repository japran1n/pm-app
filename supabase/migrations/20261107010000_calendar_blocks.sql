-- ClickUp "Planner"-style calendar blocks: freeform, generically-named
-- time blocks a member drags onto the calendar (e.g. "Morning meeting
-- 08:05", "Stenmagasinet 10:00-14:30") that are NOT task entities --
-- optional soft link to a task via `task_id`, never required.
--
-- Modelled the same way saved_views (20260826010000) models a
-- workspace-wide-or-project-scoped row: workspace_id is always required
-- (the workspace is the RLS/visibility floor for this whole feature),
-- project_id is nullable because a block is not required to belong to any
-- project ("Morning meeting" has no project). user_id is the block's
-- owner (creator/assignee) -- who created and "owns" this block on their
-- calendar, mirroring saved_views' owner_id column name choice.
--
-- Visibility: reuses the exact two-branch shape saved_views_insert_visible
-- established -- project_id is not null => public.is_project_visible_to
-- (project_id) (never visible to someone who can't see that project);
-- project_id is null => public.is_active_workspace_member(workspace_id)
-- (any active workspace member can see an unscoped block, same floor the
-- calendar's own task view already uses for workspace-wide visibility).
--
-- Full select/insert/update/delete sweep (no admin-client bypass) --
-- matches saved_views' own "written through this table's own RLS" choice
-- since there is no equivalent to F228's admin-only path for this
-- feature.
--
-- FKs: workspace_id/project_id/user_id/task_id all `on delete cascade` --
-- a calendar block has no independent lifecycle once its workspace,
-- project, owning user, or linked task is gone (same posture as
-- saved_views' own FK cascade choice, and there's no "last block" guard
-- invariant anywhere in this feature's assertions).

create table if not exists public.calendar_blocks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_blocks_title_not_empty check (btrim(title) <> ''),
  constraint calendar_blocks_time_order check (ends_at > starts_at)
);

create index if not exists calendar_blocks_workspace_id_starts_at_idx
  on public.calendar_blocks (workspace_id, starts_at);

create index if not exists calendar_blocks_user_id_idx
  on public.calendar_blocks (user_id);

create index if not exists calendar_blocks_task_id_idx
  on public.calendar_blocks (task_id)
  where task_id is not null;

alter table public.calendar_blocks enable row level security;

create policy calendar_blocks_select_visible
  on public.calendar_blocks
  for select
  to authenticated
  using (
    (project_id is not null and public.is_project_visible_to(project_id))
    or (project_id is null and public.is_active_workspace_member(workspace_id))
  );

create policy calendar_blocks_insert_visible
  on public.calendar_blocks
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      (project_id is not null and public.is_project_visible_to(project_id))
      or (project_id is null and public.is_active_workspace_member(workspace_id))
    )
  );

-- UPDATE (move/resize/rename): scoped to the block's own creator, same
-- "owner only" floor saved_views_update_own uses for a personal row --
-- there is no assertion in this feature requiring any OTHER workspace
-- member to move/resize someone else's block.
create policy calendar_blocks_update_own
  on public.calendar_blocks
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      (project_id is not null and public.is_project_visible_to(project_id))
      or (project_id is null and public.is_active_workspace_member(workspace_id))
    )
  );

create policy calendar_blocks_delete_own
  on public.calendar_blocks
  for delete
  to authenticated
  using (user_id = auth.uid());

-- No policy for anon: absence of a matching policy denies access by
-- default under RLS, matching this repo's established convention.

create trigger calendar_blocks_set_updated_at
  before update on public.calendar_blocks
  for each row execute function public.set_updated_at();
