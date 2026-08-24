-- F220: removing a board column requires an explicit destination column,
-- and the reassignment + delete happen atomically (AS-406).
--
-- Why an RPC rather than a two-statement Server Action: `tasks.status_id`
-- has no `on delete` action (defaults to NO ACTION,
-- supabase/migrations/20260824010000_project_statuses.sql just declares
-- `references project_statuses(id)`), so today a raw delete of a column
-- with tasks in it is rejected outright by the FK — no task is orphaned,
-- but it is also impossible to ever remove a non-empty column. An
-- "update tasks then delete the column" pair of statements from
-- lib/actions/statuses.ts would fix that, but a crash/network failure
-- between the two statements would leave the column deleted with the FK
-- update either not applied (impossible, FK would then block the delete)
-- or applied but the tasks.status text out of sync if the app forgot to
-- set it — the atomicity has to be enforced by the database, not by
-- hoping the Server Action runs both statements. This function moves
-- every task off the source column and deletes it inside ONE implicit
-- transaction, the same PL/pgSQL-RPC idiom this repo already uses for
-- multi-statement atomic writes (supabase/migrations/
-- 20260822190000_rpc_create_project_from_template.sql).
--
-- SECURITY DEFINER, called via the admin client from
-- lib/actions/statuses.ts's `removeColumnWithReassignment`, which
-- re-checks `canManageColumns` (AS-414) and `isProjectVisibleToCaller`
-- BEFORE calling this function — mirrors create_project_from_template's
-- documented convention: this function trusts its caller and is granted
-- only to `service_role`, never to `authenticated`, so it cannot be
-- invoked directly by a client bypassing those checks.
--
-- Validates, INSIDE the transaction (not just app-layer, so a raced
-- concurrent delete of the destination column cannot slip through):
--   - the destination column exists and belongs to the SAME project as
--     the source column (rejects a cross-project destination id);
--   - the destination is not the same column as the source.
-- AS-415 (never zero columns) is left to the existing
-- `project_statuses_prevent_last_delete` trigger, which still fires on
-- the `delete from project_statuses` below — no need to duplicate that
-- guard here.
create or replace function public.reassign_and_delete_project_status(
  p_source_status_id uuid,
  p_destination_status_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_project_id uuid;
  v_destination_project_id uuid;
  v_destination_name text;
begin
  if p_source_status_id = p_destination_status_id then
    raise exception 'The destination column must be different from the column being removed.'
      using errcode = '22023';
  end if;

  select project_id into v_source_project_id
  from project_statuses
  where id = p_source_status_id
  for update;

  if v_source_project_id is null then
    raise exception 'Column not found.'
      using errcode = 'P0002';
  end if;

  select project_id, name into v_destination_project_id, v_destination_name
  from project_statuses
  where id = p_destination_status_id;

  if v_destination_project_id is null then
    raise exception 'Destination column not found.'
      using errcode = 'P0002';
  end if;

  if v_destination_project_id <> v_source_project_id then
    raise exception 'The destination column must belong to the same project.'
      using errcode = '22023';
  end if;

  -- Move every task off the source column. Writing `status` (not just
  -- `status_id`) so `tasks.status` (still the live column every existing
  -- board/list/filter reader uses, per F218/F219) is updated in the SAME
  -- statement rather than relying on the sync trigger's status_id branch,
  -- which mirrors the existing write convention used everywhere else in
  -- this codebase (write status text, let the trigger derive status_id).
  update tasks
  set status = v_destination_name,
      status_id = p_destination_status_id
  where status_id = p_source_status_id;

  -- The `project_statuses_prevent_last_delete` trigger still applies here
  -- (AS-415) — if the source column was the project's last one, this
  -- delete is rejected and the whole transaction (including the task
  -- moves above) rolls back atomically.
  delete from project_statuses
  where id = p_source_status_id;
end;
$$;

revoke all on function public.reassign_and_delete_project_status(uuid, uuid) from public;
grant execute on function public.reassign_and_delete_project_status(uuid, uuid) to service_role;
