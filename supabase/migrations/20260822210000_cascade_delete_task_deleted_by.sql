-- F188 (AS-347): stamp `deleted_by` from within `cascade_delete_task`
-- itself, not as a second UPDATE from lib/actions/tasks.ts after the RPC
-- returns — the whole point of that RPC being one PL/pgSQL function body
-- is atomicity (see 20260819071821_subtask_cascade_delete.sql's doc
-- comment: "a single PL/pgSQL function body is atomic by construction").
-- A follow-up `.update({ deleted_by })` call from the Server Action would
-- reintroduce exactly the two-statements-not-one-transaction crash window
-- that migration was written to avoid.
--
-- `p_deleted_by` is given a `default null` so the function's existing
-- single-argument call shape keeps working for any other caller (there is
-- none today — deleteTask is the only caller — but this keeps the change
-- additive/backward-compatible per this mission's migration convention).
--
-- Cascaded children (deleted as a side effect of their parent) are
-- deliberately stamped with the SAME `deleted_by` as the parent — the
-- child wasn't deleted by a separate actor, it was deleted by the same
-- action the caller took on the parent; this matches `deleted_via_task_id`
-- already recording the parent as the cause. Documented in
-- lib/actions/tasks.ts's deleteTask doc comment.
create or replace function public.cascade_delete_task(
  p_task_id uuid,
  p_deleted_by uuid default null
)
returns table (id uuid, deleted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  update tasks
    set deleted_at = now(),
        deleted_by = p_deleted_by
    where tasks.id = p_task_id
      and tasks.deleted_at is null;

  update tasks
    set deleted_at = now(),
        deleted_via_task_id = p_task_id,
        deleted_by = p_deleted_by
    where tasks.parent_task_id = p_task_id
      and tasks.deleted_at is null;

  return query
    select t.id, t.deleted_at
    from tasks t
    where t.id = p_task_id;
end;
$$;

revoke all on function public.cascade_delete_task(uuid, uuid) from public;
grant execute on function public.cascade_delete_task(uuid, uuid) to service_role;
