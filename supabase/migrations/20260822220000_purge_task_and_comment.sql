-- F192 (AS-348, AS-349): permanent purge of an already-trashed task or
-- comment. Two SECURITY DEFINER RPCs, both granted to service_role only
-- (same "no membership check of its own, called exclusively from an
-- already-re-checked Server Action" convention as cascade_delete_task,
-- 20260819071821_subtask_cascade_delete.sql):
--
--   purge_task(p_task_id)    — hard-deletes a soft-deleted task and every
--                              row this mission's tables added that
--                              reference it (checklist_items has no
--                              cascade; task_dependencies/task_assignees/
--                              task_watchers already cascade at the DB
--                              level per their own FKs, see the grep this
--                              feature's brief pointed at, but are also
--                              covered here defensively/explicitly so this
--                              function's behaviour does not silently
--                              depend on another migration never changing
--                              those FKs). Also cleans up the
--                              pre-existing (mission-1) tables that
--                              reference a task with NO cascade rule at
--                              all — comments, active_timers,
--                              time_entries — since without deleting
--                              those rows first, the final `delete from
--                              tasks` below would fail on their FK
--                              constraint. attachments rows are deleted
--                              here too, but the Storage OBJECTS backing
--                              them cannot be removed from inside SQL —
--                              this function returns their file_url paths
--                              so the calling Server Action can remove
--                              the actual Storage objects via the Storage
--                              API before/alongside this call (see
--                              lib/actions/purge.ts).
--   purge_comment(p_comment_id) — hard-deletes a soft-deleted comment. No
--                              other table references a comment row (grep
--                              confirmed: no `references comments` in any
--                              migration), so no dependent cleanup is
--                              needed beyond the row itself.
--
-- Both functions RAISE an exception (not a silent no-op) when the target
-- row is not soft-deleted (`deleted_at is null`) or does not exist — this
-- is the hard boundary the feature's own brief calls out: "never allow
-- purging a live row". The calling Server Action pre-checks this too
-- (defense in depth), but the DB-level check is what makes it impossible
-- to purge a live row even if a future caller forgets that check.
--
-- Self-referencing cleanup for purge_task: a task being purged may still
-- be pointed at by other tasks' `parent_task_id` / `deleted_via_task_id`
-- columns (both plain FKs to tasks.id with no cascade/set-null rule) —
-- e.g. its own cascade-deleted subtask children. Deleting the parent
-- without clearing those references first would fail the same FK
-- constraint. Both are provenance/relationship columns, not data the
-- purge is responsible for preserving once their target is gone, so they
-- are nulled out (not deleted) on any row that still points at
-- p_task_id — this leaves those other rows (a task's own trash entry,
-- for example) intact, just no longer pointing at a row that no longer
-- exists. `recurrence_parent_id` already has `on delete set null`
-- (20260822140000_tasks_recurrence.sql) so it needs no explicit handling
-- here.

create or replace function public.purge_task(p_task_id uuid)
returns table (
  id uuid,
  attachment_paths text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_at timestamptz;
  v_paths text[];
begin
  select t.deleted_at into v_deleted_at
  from tasks t
  where t.id = p_task_id
  for update;

  if v_deleted_at is null then
    raise exception 'purge_task: task % is not in the trash (not soft-deleted) or does not exist', p_task_id;
  end if;

  -- Collect Storage object paths before deleting the rows that reference
  -- them, so the caller can remove the actual objects afterward.
  select coalesce(array_agg(a.file_url), array[]::text[])
    into v_paths
  from attachments a
  where a.task_id = p_task_id;

  -- Dependent rows with no cascade rule (this mission's tables, per this
  -- feature's brief).
  delete from checklist_items where task_id = p_task_id;

  -- Dependent rows with no cascade rule (pre-existing mission-1 tables) —
  -- required so the final task delete below does not fail its FK.
  delete from comments where task_id = p_task_id;
  delete from active_timers where task_id = p_task_id;
  delete from time_entries where task_id = p_task_id;
  delete from attachments where task_id = p_task_id;

  -- task_dependencies / task_assignees / task_watchers already cascade at
  -- the DB level (on delete cascade on both task_id and
  -- blocking_task_id/blocked_task_id) — explicit deletes here anyway, so
  -- this function's correctness never silently depends on those FK
  -- definitions never changing.
  delete from task_dependencies
    where blocking_task_id = p_task_id or blocked_task_id = p_task_id;
  delete from task_assignees where task_id = p_task_id;
  delete from task_watchers where task_id = p_task_id;

  -- Clear provenance/relationship references FROM other tasks TO this one
  -- (see doc comment above) so the final delete's own FK is satisfiable.
  update tasks set parent_task_id = null where parent_task_id = p_task_id;
  update tasks set deleted_via_task_id = null where deleted_via_task_id = p_task_id;

  delete from tasks where tasks.id = p_task_id;

  return query select p_task_id, v_paths;
end;
$$;

revoke all on function public.purge_task(uuid) from public;
grant execute on function public.purge_task(uuid) to service_role;

create or replace function public.purge_comment(p_comment_id uuid)
returns table (id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_at timestamptz;
begin
  select c.deleted_at into v_deleted_at
  from comments c
  where c.id = p_comment_id
  for update;

  if v_deleted_at is null then
    raise exception 'purge_comment: comment % is not in the trash (not soft-deleted) or does not exist', p_comment_id;
  end if;

  delete from comments where comments.id = p_comment_id;

  return query select p_comment_id;
end;
$$;

revoke all on function public.purge_comment(uuid) from public;
grant execute on function public.purge_comment(uuid) to service_role;
