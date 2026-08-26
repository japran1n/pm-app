-- C7 (docs/client-portal-plan.md): let a client comment on work shared with
-- them, and give the team a private thread on the same task.
--
-- The default is the whole design here. `internal` defaults to FALSE at the
-- column level (so nothing about existing app code changes shape), but every
-- pre-existing comment is backfilled to TRUE, and the team's composer writes
-- TRUE unless someone explicitly ticks "visible to client".
--
-- Why: every comment written before this migration was written in a room
-- with no client in it. If `internal` defaulted to false for those rows,
-- adding a client to an old project would retroactively hand them years of
-- internal discussion — scoping decisions, budget remarks, opinions about
-- their own requests. A feature that leaks history the moment it is switched
-- on is not a feature. The cost of the other direction is that the team must
-- tick a box to say something to the client, which is a cost worth paying and
-- the same bargain `tasks.client_visible` already makes.
--
-- A client's own comments are never internal: they wrote them for the team,
-- and the team can see everything on the task regardless.

alter table comments
  add column if not exists internal boolean not null default false;

-- Backfill: everything that already exists predates the client role.
-- Written as a one-shot update rather than a column default of true so the
-- intent is explicit and the default stays honest for new rows.
update comments set internal = true where internal = false;

-- The portal reads "non-internal comments on this task", so index that.
create index if not exists comments_task_id_internal_idx
  on comments (task_id, internal);

-- ---------------------------------------------------------------------
-- SELECT: a client never sees an internal comment
-- ---------------------------------------------------------------------
-- Same shape as the tasks policy: `not internal or not is_task_client(...)`
-- means the team's view is byte-for-byte what it was before.

drop policy if exists comments_select_active_members on comments;
create policy comments_select_active_members
  on comments
  for select
  to authenticated
  using (
    deleted_at is null
    and public.is_task_visible_to(task_id)
    and (not internal or not public.is_task_client(task_id))
  );

-- Deleted comments are a team-side concern (the trash view); a client has
-- no such view and no business reading withdrawn text.
drop policy if exists comments_select_trash_visible_members on comments;
create policy comments_select_trash_visible_members
  on comments
  for select
  to authenticated
  using (
    deleted_at is not null
    and public.is_task_visible_to(task_id)
    and not public.is_task_client(task_id)
  );

-- ---------------------------------------------------------------------
-- INSERT: the client half, added alongside the existing team half
-- ---------------------------------------------------------------------
-- `is_task_workspace_writer` (the pre-existing gate) still excludes
-- clients, so the client branch is additive and cannot loosen the team
-- one. A client may comment only on a task actually shared with them
-- (`is_task_visible_to` already encodes that for clients), only as
-- themselves, and never as internal.

drop policy if exists comments_insert_active_members on comments;
create policy comments_insert_active_members
  on comments
  for insert
  to authenticated
  with check (
    public.is_task_workspace_writer(task_id)
    or (
      public.is_task_client(task_id)
      and public.is_task_visible_to(task_id)
      and user_id = auth.uid()
      and internal = false
    )
  );
