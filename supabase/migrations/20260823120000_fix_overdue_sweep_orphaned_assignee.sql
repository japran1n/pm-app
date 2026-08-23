-- F321 (M15 scrutiny pass 6, finding B1, AS-383): fix
-- public.notify_overdue_task_assignees() (F212,
-- 20260823050000_overdue_notification_sweep.sql) permanently breaking
-- for the ENTIRE database the first time any workspace member is ever
-- removed.
--
-- The bug, confirmed against the current code before this migration was
-- written:
--
-- 1. `remove_workspace_member` (20260817234900_remove_member_atomic_
--    owner_guard.sql) hard-`delete`s only the `workspace_members` row for
--    the removed user -- nothing anywhere cleans up that user's
--    `task_assignees` rows, so an orphaned assignee row (task still
--    assigned to a user no longer in the workspace) is a normal, expected
--    state in this schema, not an edge case.
-- 2. `notification_preferences` is keyed on `user_id` alone (not
--    per-workspace) and is auto-created for every auth user with
--    `task_due_soon_in_app` defaulting to `true`
--    (20260823040000_create_notification_preferences.sql), so the
--    removed user's preference row survives and still passes the
--    sweep's `np.task_due_soon_in_app = true` filter.
-- 3. The sweep's driving SELECT joins
--    `tasks -> projects -> task_assignees -> notification_preferences`
--    and never joins `workspace_members`, so it happily selects that
--    orphaned assignee row and calls `create_notification` with it.
-- 4. `create_notification` (20260823110000_create_notification_task_
--    workspace_check.sql) unconditionally `raise exception`s when the
--    RECIPIENT is not an active member of the target workspace, and that
--    check runs BEFORE the `p_system` branch -- so the cron's
--    `p_system => true` does not exempt this call from it.
-- 5. The sweep's `for ... loop` had no exception handling, so that raise
--    aborted the ENTIRE function and rolled back the whole transaction:
--    zero notifications sent for anyone, in any workspace, on that run.
-- 6. Because the run rolled back, `notifications_overdue_once_idx`'s
--    dedup gate (only satisfied once a notification row actually exists)
--    was never satisfied for anyone -- so every subsequent hourly run hit
--    the exact same orphaned row and failed identically. Permanently.
--
-- Fix, both halves required:
--
-- (a) Join `workspace_members` in the sweep's SELECT, requiring the
--     assignee (`ta.user_id`) to be an `active` member of the task's own
--     workspace (`p.workspace_id`) -- the exact same membership predicate
--     shape `create_notification` itself already uses for this check
--     (`wm.workspace_id = ... and wm.user_id = ... and wm.status =
--     'active'`, see 20260823110000's recipient check) and the same
--     shape `public.is_active_workspace_member`
--     (20260817222822_rls_workspaces.sql) uses. An orphaned/removed-
--     member assignee row is now simply skipped by the WHERE join
--     instead of being handed to `create_notification` to blow up on.
--
-- (b) Defense in depth: wrap the `perform public.create_notification(...)`
--     call in a per-row `begin ... exception when others then ... end;`
--     block so no single bad row -- from (a)'s specific cause, or any
--     future unanticipated per-row failure -- can ever abort the whole
--     sweep again. Logs via `raise warning` (visible in Postgres logs,
--     does not abort) and continues to the next row. This matters
--     specifically because this function runs unattended on an hourly
--     pg_cron schedule with nobody watching a terminal.
--
--     A unique_violation (SQLSTATE 23505) against
--     `notifications_overdue_once_idx` is caught by the same `when
--     others` handler, but that is the EXPECTED, harmless case documented
--     in 20260823050000's own header comment (the index is a concurrency
--     backstop against two overlapping sweep runs both passing the
--     `not exists` pre-check for the same row) -- catching and logging it
--     here does not change that behavior: the row was already
--     successfully not-double-notified by the unique index doing its
--     job; this handler just stops that from taking the rest of the loop
--     down with it, same as any other per-row exception.
--
-- Signature is unchanged (still `returns integer`, no arguments) so
-- `create or replace function` is sufficient; no drop needed.
create or replace function public.notify_overdue_task_assignees()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_notified_count integer := 0;
begin
  for v_row in
    select t.id as task_id, t.title as task_title, t.due_date as due_date,
           p.id as project_id, p.workspace_id as workspace_id,
           ta.user_id as assignee_id
    from tasks t
    join projects p on p.id = t.project_id
    join task_assignees ta on ta.task_id = t.id
    join notification_preferences np on np.user_id = ta.user_id
    -- F321: an assignee must still be an active member of the task's own
    -- workspace. Without this join, a user removed from the workspace
    -- (whose task_assignees row is never cleaned up -- see this
    -- migration's header comment) is still selected here and handed to
    -- create_notification, which raises on a non-member recipient and
    -- (before this fix) aborted the whole sweep for every workspace.
    join workspace_members wm
      on wm.workspace_id = p.workspace_id
     and wm.user_id = ta.user_id
     and wm.status = 'active'
    where t.due_date is not null
      and t.due_date <= (now() at time zone 'utc')::date
      and t.status <> 'done'
      and t.deleted_at is null
      and p.deleted_at is null
      and np.task_due_soon_in_app = true
      and not exists (
        select 1
        from notifications n
        where n.user_id = ta.user_id
          and n.task_id = t.id
          and n.kind = 'task_due_soon'
      )
  loop
    -- F321: per-row exception handling -- one bad row (an unanticipated
    -- future failure mode, or a benign unique_violation race against
    -- notifications_overdue_once_idx from an overlapping sweep run, see
    -- this migration's header comment) must never abort the whole sweep
    -- and roll back every other assignee's notification in the same run.
    begin
      perform public.create_notification(
        p_user_id => v_row.assignee_id,
        p_workspace_id => v_row.workspace_id,
        p_kind => 'task_due_soon',
        p_actor_id => null,
        p_task_id => v_row.task_id,
        p_comment_id => null,
        p_payload => jsonb_build_object('task_title', v_row.task_title, 'due_date', v_row.due_date),
        p_system => true
      );

      v_notified_count := v_notified_count + 1;
    exception
      when others then
        raise warning
          'notify_overdue_task_assignees: failed to notify user % for task % (workspace %): % (%)',
          v_row.assignee_id, v_row.task_id, v_row.workspace_id, sqlerrm, sqlstate;
    end;
  end loop;

  return v_notified_count;
end;
$$;

comment on function public.notify_overdue_task_assignees() is
  'F212/F321 (AS-383): hourly sweep notifying each assignee of a task once its due date has passed (UTC-only for now -- see 20260823050000''s header comment). Skips archived projects, trashed tasks, done-category tasks, assignees who opted out via notification_preferences.task_due_soon_in_app, and (F321) assignees who are no longer an active member of the task''s workspace (orphaned task_assignees rows left behind by remove_workspace_member). Per-row exception handling means one bad/unanticipated row can never abort the whole sweep. Idempotent -- see notifications_overdue_once_idx. SECURITY DEFINER so pg_cron (running as postgres, no human session) can call create_notification(..., p_system => true), the sanctioned path F206''s spoofing fix added exactly for this case.';

revoke all on function public.notify_overdue_task_assignees() from public;
grant execute on function public.notify_overdue_task_assignees() to postgres, service_role;
