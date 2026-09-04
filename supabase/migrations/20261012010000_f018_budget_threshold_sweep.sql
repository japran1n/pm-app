-- F018 (missions/20260903-portal, M4): daily pg_cron sweep that notifies
-- a project's PM(s) at 80% and 100% of the period's sold hours
-- (AS-033's budget feeding this; the notification itself isn't its own
-- assertion ID but is this feature's own scope item 4).
--
-- Two existing sweeps in this schema are the reason this one is written
-- the way it is, not the way a first draft would be:
--
-- 1. 20260823050000_overdue_notification_sweep.sql "nagged hourly" --
--    its own dedup is per (user_id, task_id), fine for "notify once
--    ever", but this feature's own primary success test is "one
--    notification per threshold PER PERIOD" -- a plain per-project
--    unique key would never re-arm for the next period, and a
--    per-project-per-run key (no dedup at all) is the literal
--    "nagged hourly" (here: nagged daily) failure this sweep must not
--    repeat. The fix here: the unique dedup key includes the budget's
--    own period_start, so a new period is a genuinely new key.
-- 2. 20260823120000_fix_overdue_sweep_orphaned_assignee.sql documents
--    the opposite failure mode: an unhandled exception on ONE bad row
--    inside a `for ... loop` rolled back the ENTIRE run (including rows
--    that would otherwise have inserted their own dedup marker), so
--    every subsequent run hit the exact same row and failed identically
--    -- "over-corrected into permanent silence" is that migration's own
--    postmortem, restated in this feature's spec verbatim. This sweep
--    copies both of that fix's defenses from the start: the recipient
--    must be an active workspace member before create_notification is
--    ever called, and the create_notification call is wrapped in a
--    per-row `begin ... exception when others then raise warning` block
--    so one bad project can never take the rest of the run down with
--    it.
--
-- ---------------------------------------------------------------------
-- 1. notifications: two new kind values + a project_id column so the
--    dedup key can be expressed as a real unique index rather than a
--    jsonb-payload NOT EXISTS check alone (matching
--    notifications_overdue_once_idx's own "DB-level backstop, not just
--    an app-level guard" shape).
-- ---------------------------------------------------------------------
alter table public.notifications
  add column if not exists project_id uuid references public.projects (id) on delete cascade;

create index if not exists notifications_project_id_idx
  on public.notifications (project_id)
  where project_id is not null;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (
  kind in (
    'mention', 'comment_reply', 'task_assigned', 'task_due_soon', 'watcher_update',
    'budget_threshold_80', 'budget_threshold_100'
  )
);

-- Dedup key: at most one notification per (project_id, kind, period,
-- recipient) -- a project can have more than one lead, and each is its
-- own recipient, so user_id is part of the key alongside project_id/
-- kind/period_start (read out of the payload this sweep itself writes,
-- `payload->>'period_start'`, rather than a new dedicated column --
-- notifications has no other per-kind extra column either; task_due_soon's
-- own "extra" data, due_date, also lives in payload, not a column). A new
-- period has a different period_start, so this key naturally re-arms per
-- period without ever re-notifying inside the same one -- the AS this
-- migration's own primary success test checks.
create unique index if not exists notifications_budget_threshold_once_idx
  on public.notifications (project_id, user_id, kind, (payload ->> 'period_start'))
  where kind in ('budget_threshold_80', 'budget_threshold_100') and project_id is not null;

comment on index public.notifications_budget_threshold_once_idx is
  'F018: at most one budget_threshold_80/_100 notification per (project_id, user_id, period_start) -- a new budget period is a new key, so the sweep re-arms per period without ever repeating inside one, and each project lead is dedup''d independently. DB-level backstop; the sweep function''s own NOT EXISTS check is the primary gate.';

-- ---------------------------------------------------------------------
-- 2. sweep_project_budget_thresholds()
-- ---------------------------------------------------------------------
-- "The project's PM": this schema has no dedicated PM column anywhere on
-- `projects` (checked: `create table if not exists projects`,
-- 20260818004413_create_projects.sql, has no such column) -- the closest
-- existing concept is `project_members.project_role = 'lead'`
-- (20260821140520_project_members.sql), the one place this schema
-- already distinguishes a project lead from a plain member. A project
-- with no explicit lead row is skipped for that project's threshold
-- notifications entirely (there is nowhere sanctioned to send it, and
-- guessing workspace owner/admin would be a second, silent definition of
-- "PM" alongside project_members.project_role) -- recorded as this
-- migration's own AUTONOMOUS_DECISION in the feature's handoff.
--
-- Spend is computed the same way project_hours_client counts "spent" --
-- billable minutes only, matching sold_minutes being sold (billable)
-- hours, not raw logged time including non-billable work.
create or replace function public.sweep_project_budget_thresholds()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_budget record;
  v_lead record;
  v_spent_minutes integer;
  v_pct numeric;
  v_kind text;
  v_notified_count integer := 0;
  v_notification public.notifications;
begin
  for v_budget in
    select pb.id as budget_id, pb.project_id, pb.period_start, pb.period_end,
           pb.sold_minutes, p.workspace_id
    from project_budgets pb
    join projects p on p.id = pb.project_id
    where p.deleted_at is null
      -- Only periods that have started and not yet ended (plus a
      -- grace day so the 100% notification can still fire for a period
      -- that just closed) are considered -- a future period has no
      -- spend to threshold against, and a long-closed period has
      -- already been swept on every prior day it was open.
      and pb.period_start <= (now() at time zone 'utc')::date
      and pb.period_end >= (now() at time zone 'utc')::date - 1
  loop
    select coalesce(sum(te.minutes), 0)::integer
      into v_spent_minutes
      from time_entries te
      join tasks t on t.id = te.task_id
      where t.project_id = v_budget.project_id
        and t.deleted_at is null
        and te.billable
        and te.entry_date >= v_budget.period_start
        and te.entry_date <= v_budget.period_end;

    if v_budget.sold_minutes <= 0 then
      continue;
    end if;

    v_pct := (v_spent_minutes::numeric / v_budget.sold_minutes::numeric) * 100;

    -- 100% takes priority over 80% on the same run (a project that
    -- jumps straight past 80% to 100%+ between two daily runs gets the
    -- 100% notification, not both) -- each is still its own kind/dedup
    -- key, so if 80% was already sent on an earlier run and 100% is
    -- reached later, both notifications exist, one per threshold, per
    -- this feature's own "one notification per project per threshold
    -- per period" rule.
    if v_pct >= 100 then
      v_kind := 'budget_threshold_100';
    elsif v_pct >= 80 then
      v_kind := 'budget_threshold_80';
    else
      continue;
    end if;

    for v_lead in
      select pm.user_id
      from project_members pm
      join workspace_members wm
        on wm.workspace_id = v_budget.workspace_id
       and wm.user_id = pm.user_id
       and wm.status = 'active'
      where pm.project_id = v_budget.project_id
        and pm.project_role = 'lead'
    loop
      if exists (
        select 1
        from notifications n
        where n.project_id = v_budget.project_id
          and n.kind = v_kind
          and n.payload ->> 'period_start' = v_budget.period_start::text
          and n.user_id = v_lead.user_id
      ) then
        continue;
      end if;

      begin
        -- create_notification (20260823020000) returns the inserted row
        -- (`returns public.notifications`), captured here so project_id
        -- can be set on that EXACT row by id below -- no time-window
        -- guess, no risk of updating a different concurrent row.
        select * into v_notification from public.create_notification(
          p_user_id => v_lead.user_id,
          p_workspace_id => v_budget.workspace_id,
          p_kind => v_kind,
          p_actor_id => null,
          p_task_id => null,
          p_comment_id => null,
          p_payload => jsonb_build_object(
            'project_id', v_budget.project_id,
            'period_start', v_budget.period_start,
            'period_end', v_budget.period_end,
            'sold_minutes', v_budget.sold_minutes,
            'spent_minutes', v_spent_minutes,
            'percent', round(v_pct)
          ),
          p_system => true
        );
      exception when others then
        -- F018 (per 20260823120000's own lesson): one bad row must
        -- never roll back the whole run -- that is what turned an
        -- earlier sweep's dedup gate into permanent silence. Warn and
        -- move on; the NOT EXISTS check above (and the unique index
        -- backstop) means a retried run will simply try this same row
        -- again next time.
        raise warning 'sweep_project_budget_thresholds: notify failed for project %, user %: %',
          v_budget.project_id, v_lead.user_id, sqlerrm;
        continue;
      end;

      -- create_notification's own signature (20260823020000) has no
      -- project_id parameter, and this migration deliberately does not
      -- touch that shared, multi-feature function to add a ninth
      -- parameter for one caller -- project_id is filled in here, on the
      -- exact row just inserted (v_notification.id), as a follow-up
      -- UPDATE instead.
      update notifications set project_id = v_budget.project_id where id = v_notification.id;

      v_notified_count := v_notified_count + 1;
    end loop;
  end loop;

  return v_notified_count;
end;
$$;

comment on function public.sweep_project_budget_thresholds() is
  'F018: daily sweep notifying each project''s lead(s) (project_members.project_role = ''lead'') once per project per threshold (80%%, 100%%) per budget period. Idempotent via notifications_budget_threshold_once_idx (project_id, kind, period_start) plus this function''s own NOT EXISTS pre-check. Per-row exception handling so one bad project can never roll back the whole run (see this migration''s header for the precedent that made that necessary).';

revoke all on function public.sweep_project_budget_thresholds() from public;
grant execute on function public.sweep_project_budget_thresholds() to postgres, service_role;

-- Daily, per this feature's own spec ("A daily pg_cron sweep"). Offset
-- from the two existing hourly sweeps' own minute (both run on the
-- hour, minute 0) so this doesn't contend with them for the same tick;
-- time of day is otherwise arbitrary for a daily job with no declared
-- deadline. `cron.schedule(job_name, ...)` is idempotent by name (pg_cron
-- 1.4+, this project runs 1.6.4 per 20260823050000's own verified note),
-- so re-running this migration updates the existing job in place rather
-- than duplicating it.
select cron.schedule(
  'sweep-project-budget-thresholds',
  '30 6 * * *',
  $$select public.sweep_project_budget_thresholds();$$
);
