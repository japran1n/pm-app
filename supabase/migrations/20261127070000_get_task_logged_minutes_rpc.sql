-- P2-15: replace direct .in("task_id", taskIds) with an RPC that aggregates
-- server-side, bypassing Supabase's 1000-row silent cap on .in() filters.
-- security invoker: RLS on time_entries still applies (the policy
-- time_entries_select_active_members governs what rows the caller sees).
create or replace function public.get_task_logged_minutes(p_task_ids uuid[])
returns table (task_id uuid, logged_minutes numeric)
language sql
security invoker
stable
set search_path = public
as $$
  select task_id, sum(minutes) as logged_minutes
  from public.time_entries
  where task_id = any(p_task_ids)
  group by task_id;
$$;

revoke all on function public.get_task_logged_minutes(uuid[]) from public;
grant execute on function public.get_task_logged_minutes(uuid[]) to authenticated;
