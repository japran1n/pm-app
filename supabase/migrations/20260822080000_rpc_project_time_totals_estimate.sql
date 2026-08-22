-- F168: extend `get_project_time_totals` (F114, supabase/migrations/
-- 20260818160000_rpc_project_time_totals.sql) to also return the project's
-- summed task estimate, so the project header can show summed estimates
-- against summed logged time (AS-303).
--
-- AS-304 ("totals exclude soft-deleted tasks"): the estimate sum is filtered
-- on `t.deleted_at is null`, the exact convention this RPC already uses for
-- its billable/non-billable sums (see the F114 migration's own comment).
-- Scope note, matching F144's precedent for this same RPC (F144's migration
-- 20260822010000_active_project_tasks_view_and_time_report_fix.sql
-- comment): `get_project_time_totals` is scoped by a single p_project_id —
-- a project viewing its OWN data on its OWN detail page, not a cross-project
-- workspace aggregate — so it intentionally does NOT filter on the project
-- itself being non-archived. An archived project's own detail page still
-- shows its own historical estimate/logged totals when viewed directly,
-- exactly as F144 already decided for this RPC's existing billable/
-- non-billable columns. Only individual soft-deleted TASKS (`t.deleted_at`)
-- are excluded, matching AS-304's literal wording ("soft-deleted tasks", not
-- "archived projects").
--
-- `create or replace` cannot be used here because the OUT-parameter shape
-- changes (a third returned column is added) — Postgres requires a `drop
-- function` first when the return type changes, the same pattern F167's
-- follow-up fix and F161 already used this session for the same reason.
drop function if exists get_project_time_totals(uuid);

create function get_project_time_totals(p_project_id uuid)
returns table (
  billable_minutes bigint,
  non_billable_minutes bigint,
  estimate_minutes bigint
)
language sql
stable
security invoker
as $$
  select
    coalesce(sum(te.minutes) filter (where te.billable), 0)::bigint as billable_minutes,
    coalesce(sum(te.minutes) filter (where not te.billable), 0)::bigint as non_billable_minutes,
    coalesce((
      select sum(t2.estimate_minutes)
      from tasks t2
      where t2.project_id = p_project_id
        and t2.deleted_at is null
    ), 0)::bigint as estimate_minutes
  from time_entries te
  join tasks t on t.id = te.task_id
  where t.project_id = p_project_id
    and t.deleted_at is null;
$$;

revoke all on function get_project_time_totals(uuid) from public;
grant execute on function get_project_time_totals(uuid) to authenticated, anon;
