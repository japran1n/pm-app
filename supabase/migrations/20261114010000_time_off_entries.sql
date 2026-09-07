-- Team PTO/vacation calendar: `time_off_entries`, a per-user date-only
-- range a workspace member marks themselves out for (e.g. "Godišnji
-- odmor"). Mirrors calendar_blocks' own visibility posture but simplified
-- to a single floor: PTO transparency is a whole-team thing, not scoped
-- by project visibility, so every active workspace member can SEE every
-- PTO entry in that workspace, while only the entry's own owner (or an
-- owner/admin of the workspace) may create/update/delete it.
--
-- Date-only (not timestamptz) columns: PTO is a whole-day concept ("out
-- April 1-5"), never a specific time-of-day range, unlike calendar_blocks.
--
-- FKs: workspace_id/user_id both `on delete cascade` -- a PTO entry has no
-- independent lifecycle once its workspace or owning user is gone, same
-- posture calendar_blocks already established for this repo.

create table if not exists public.time_off_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  note text,
  created_at timestamptz not null default now(),
  constraint time_off_entries_date_order check (end_date >= start_date),
  constraint time_off_entries_note_not_blank check (note is null or btrim(note) <> '')
);

create index if not exists time_off_entries_workspace_id_start_date_idx
  on public.time_off_entries (workspace_id, start_date);

create index if not exists time_off_entries_user_id_idx
  on public.time_off_entries (user_id);

alter table public.time_off_entries enable row level security;

-- SELECT: every active member of the workspace can see every PTO entry in
-- it -- team transparency is the explicit point of this feature, unlike
-- calendar_blocks' owner-or-project-visibility split.
create policy time_off_entries_select_active_members
  on public.time_off_entries
  for select
  to authenticated
  using (public.is_active_workspace_member(workspace_id));

-- INSERT: the caller may only create a PTO entry for THEMSELVES
-- (user_id = auth.uid()), and only while an active member of the target
-- workspace. There is no "an admin creates PTO on someone else's behalf"
-- path in this feature's spec -- that stays out of scope for this table
-- (see this feature's handoff Out-of-scope section).
create policy time_off_entries_insert_own
  on public.time_off_entries
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_active_workspace_member(workspace_id)
  );

-- UPDATE/DELETE: the entry's own owner, OR an owner/admin of the
-- workspace (per the "only VLASNIK (ili owner/admin) može kreirati/menjati/
-- brisati svoj" instruction -- "svoj" scopes creation to self, but
-- owner/admin are explicitly named as also allowed to manage entries).
create policy time_off_entries_update_own_or_admin
  on public.time_off_entries
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_workspace_admin(workspace_id)
  )
  with check (
    user_id = auth.uid()
    or public.is_workspace_admin(workspace_id)
  );

create policy time_off_entries_delete_own_or_admin
  on public.time_off_entries
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_workspace_admin(workspace_id)
  );

-- No policy for anon: absence of a matching policy denies access by
-- default under RLS, matching this repo's established convention.
