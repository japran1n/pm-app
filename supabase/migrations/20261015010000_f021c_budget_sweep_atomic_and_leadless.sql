-- F021c (missions/20260903-portal, M4 remediation): two defects the M4
-- gate found in 20261012010000's sweep_project_budget_thresholds().
--
-- 1. `update notifications set project_id = ...` (line 210 of the
--    original migration) sat AFTER the `begin ... exception when others`
--    block that wraps create_notification, not inside it -- and that
--    UPDATE is exactly where notifications_budget_threshold_once_idx
--    (the partial unique index on project_id, user_id, kind,
--    payload->>'period_start') actually raises: create_notification's
--    own INSERT never sets project_id, so the INSERT itself can never
--    collide on that index; only this follow-up UPDATE (which does set
--    project_id) can. An unhandled exception there rolls back the run
--    exactly the way 20260823120000's postmortem (quoted in the original
--    migration's own header) describes -- the "over-corrected into
--    permanent silence" failure F018 was written to prevent, still
--    reachable via the one statement its own exception block didn't
--    cover. Fix: move the UPDATE inside the exception block.
--
-- 2. A project with no `project_members.project_role = 'lead'` row was
--    swept with zero loop iterations and zero record of that fact --
--    indistinguishable from "sold_minutes <= 0" or "under 80%" in the
--    function's own return value or logs. Silence is the one option
--    that hides the problem (this feature's own spec, verbatim), so a
--    project past a threshold with no lead now gets a `raise warning`
--    naming the project/threshold/period, visible in the cron job's own
--    log the same way the per-row exception already is -- not a second,
--    silent guess at who else to notify (workspace owner/admin would be
--    a second, undocumented definition of "PM" alongside
--    project_members.project_role, which the original migration's own
--    header already rejected for the has-a-lead case).
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
  v_lead_found boolean;
begin
  for v_budget in
    select pb.id as budget_id, pb.project_id, pb.period_start, pb.period_end,
           pb.sold_minutes, p.workspace_id
    from project_budgets pb
    join projects p on p.id = pb.project_id
    where p.deleted_at is null
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

    if v_pct >= 100 then
      v_kind := 'budget_threshold_100';
    elsif v_pct >= 80 then
      v_kind := 'budget_threshold_80';
    else
      continue;
    end if;

    v_lead_found := false;

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
      v_lead_found := true;

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

        -- F021c: moved inside the exception block -- this UPDATE, not
        -- create_notification's own INSERT, is where
        -- notifications_budget_threshold_once_idx actually raises (see
        -- this migration's header), so it must be covered by the same
        -- per-row guard or one duplicate collision here still aborts the
        -- whole run.
        update notifications set project_id = v_budget.project_id where id = v_notification.id;

        v_notified_count := v_notified_count + 1;
      exception when others then
        raise warning 'sweep_project_budget_thresholds: notify failed for project %, user %: %',
          v_budget.project_id, v_lead.user_id, sqlerrm;
        continue;
      end;
    end loop;

    if not v_lead_found then
      -- F021c: a threshold-crossing project with nobody to notify is
      -- recorded, not silently skipped -- see this migration's header.
      raise warning 'sweep_project_budget_thresholds: no active project lead to notify for project %, kind %, period %',
        v_budget.project_id, v_kind, v_budget.period_start;
    end if;
  end loop;

  return v_notified_count;
end;
$$;

comment on function public.sweep_project_budget_thresholds() is
  'F018/F021c: daily sweep notifying each project''s lead(s) (project_members.project_role = ''lead'') once per project per threshold (80%%, 100%%) per budget period. Idempotent via notifications_budget_threshold_once_idx (project_id, kind, period_start) plus this function''s own NOT EXISTS pre-check. The project_id UPDATE and create_notification are both inside one per-row exception block so one bad project can never roll back the whole run; a project with no active lead is recorded via RAISE WARNING rather than skipped silently.';
