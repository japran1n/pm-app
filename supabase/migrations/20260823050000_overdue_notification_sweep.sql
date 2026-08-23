-- F212 (AS-383): scheduled overdue-task notification sweep.
--
-- Hourly pg_cron job (extension already enabled by F178,
-- 20260822160000_recurrence_scheduled_generation.sql -- `create extension
-- if not exists` here too so this migration is self-contained/reproducible
-- on a fresh project even if F178's migration were ever pruned) that
-- notifies each assignee of a task once its due date has passed, via the
-- existing public.create_notification() RPC (F206, fixed by F206's
-- spoofing follow-up 20260823030000) called with p_system => true -- the
-- exact sanctioned path for a scheduled job with no human session/actor,
-- per this migration's run-time instructions. Never inserts into
-- `notifications` directly (that table has no client/authenticated INSERT
-- policy by design).
--
-- Kind used: 'task_due_soon' (AS-383's assertion text is "notified when
-- their task becomes overdue" -- there is no separate 'task_overdue' value
-- in notifications_kind_check, and this feature's own preferences gating
-- column, per F211, is explicitly task_due_soon_in_app; adding a new kind
-- value would be a second/parallel concept for what F211's own migration
-- comment already documents as this feature's fan-out column. Simpler
-- option, no new dependency, no second source of truth -- recorded per the
-- clarified ambiguity-resolution answer).
--
-- Skips (per this feature's Draft scope + F211 fan-out gating):
--   - archived projects: projects.deleted_at is not null (F142's
--     established archive convention -- see 20260822000000_projects_
--     archived_by.sql's own header comment for why deleted_at IS the
--     archive timestamp, not a parallel archived_at column).
--   - trashed tasks: tasks.deleted_at is not null (mission-1 soft-delete
--     convention).
--   - done-category statuses: reuses the SAME literal comparison
--     lib/tasks/blocked-guard.ts's isDoneStatus() and lib/queries/
--     tasks.ts's getProjectBoardTasks both already use (status = 'done')
--     rather than inventing a new "done category" concept in SQL --
--     per F158's own sweep-note convention, this is the Nth call site to
--     use that same literal, not a second source of truth.
--   - a user whose notification_preferences.task_due_soon_in_app = false
--     (F211's fan-out gating, applied here as this feature's "fourth
--     fan-out call site", just running inside SQL/pg_cron instead of a
--     Server Action).
--
-- Idempotency (AS-383's "one overdue notification per task per assignee"):
-- per the clarified ambiguity-resolution answer (simplest option, no new
-- dependency, no second source of truth), this uses a unique PARTIAL index
-- directly against `notifications` itself, keyed on
-- (user_id, task_id) where kind = 'task_due_soon' -- no new tracking
-- table, no new column on task_assignees. The sweep function's INSERT path
-- (via create_notification) is guarded with a NOT EXISTS check against
-- this exact same condition immediately before calling
-- create_notification, so a re-run of the hourly sweep never re-notifies
-- an assignee for a task it already notified them about; the unique index
-- is the DB-level backstop against a race between two concurrent sweep
-- runs (Supabase Cron does not guarantee a single job cannot overlap
-- itself if a prior run is still finishing), not the primary gate.
--
-- Timezone handling ("the tricky part" per this feature's own Notes):
-- per the clarified ambiguity-resolution answer (simplest option, no new
-- dependency, no second source of truth), and confirmed by grepping
-- lib/supabase/database.types.ts's `profiles` Row type and workspace_
-- members' own columns -- neither stores a per-user timezone anywhere in
-- this schema today, and adding one (plus the settings UI to let a user
-- set it) is out of this feature's actual scope, whose Files list is
-- migrations-only. This sweep therefore treats every assignee as UTC:
-- `due_date <= (now() at time zone 'utc')::date`, i.e. a task becomes
-- "overdue" for notification purposes at UTC midnight following its due
-- date, for every user regardless of their real-world timezone. Real
-- per-assignee timezone support is recorded as an explicit future
-- enhancement below (Out-of-scope work needed, restated in the handoff).
-- pg_cron is already enabled and granted by F178
-- (20260822160000_recurrence_scheduled_generation.sql). Re-running
-- `create extension if not exists pg_cron` here is a no-op in principle,
-- but on this managed Supabase project it re-triggers a post-create hook
-- script that fails with "dependent privileges exist" (SQLSTATE 2BP01)
-- against grants that already exist from F178's migration -- confirmed via
-- `supabase db push` against the live linked project. Since the extension
-- and its grants are already guaranteed present by F178 (which every
-- feature after M15 depends on transitively through the migration order),
-- this migration deliberately does NOT repeat
-- create/grant-extension statements; it only adds the objects specific to
-- this feature.

-- Idempotency backstop (see header comment above). Partial unique index:
-- at most one 'task_due_soon' notification per (user_id, task_id) pair.
-- A plain unique index (not a constraint) is used so it can be created
-- with `if not exists`, matching this mission's other idempotent-migration
-- conventions.
create unique index if not exists notifications_overdue_once_idx
  on public.notifications (user_id, task_id)
  where kind = 'task_due_soon';

comment on index public.notifications_overdue_once_idx is
  'F212/AS-383: at most one task_due_soon notification per (user_id, task_id) -- backstop against a concurrent/overlapping sweep run double-notifying the same assignee for the same overdue task. The sweep function''s own NOT EXISTS check is the primary gate; this index is the DB-level guarantee.';

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
  end loop;

  return v_notified_count;
end;
$$;

comment on function public.notify_overdue_task_assignees() is
  'F212 (AS-383): hourly sweep notifying each assignee of a task once its due date has passed (UTC-only for now -- see this migration''s header comment). Skips archived projects, trashed tasks, done-category tasks, and assignees who opted out via notification_preferences.task_due_soon_in_app. Idempotent -- see notifications_overdue_once_idx. SECURITY DEFINER so pg_cron (running as postgres, no human session) can call create_notification(..., p_system => true), the sanctioned path F206''s spoofing fix added exactly for this case.';

revoke all on function public.notify_overdue_task_assignees() from public;
grant execute on function public.notify_overdue_task_assignees() to postgres, service_role;

-- Schedule: hourly, matching F178's own precedent and AUTONOMOUS_DECISION
-- rationale (this feature's spec: "the sweep runs hourly", explicitly
-- named in the Notes/Clarified-implementation ambiguity-resolution text
-- above -- not a worker's own interval choice this time).
select cron.schedule(
  'notify-overdue-task-assignees',
  '0 * * * *',
  $$select public.notify_overdue_task_assignees();$$
);
