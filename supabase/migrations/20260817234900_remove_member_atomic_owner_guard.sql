-- F094 (follow-up to F020, AS-018): close the TOCTOU race in removeMember's
-- sole-owner guard, found by scrutiny (M2-scrutiny.md AS-018,
-- "follow-up-sole-owner-atomic-guard").
--
-- Bug: the guard in lib/actions/workspaces.ts was check-then-act — it ran a
-- SELECT count(*) of active owners, then, if the count was > 1, ran a
-- separate DELETE. Nothing tied the two statements together. Two concurrent
-- removeMember calls against a 2-owner workspace could both run the SELECT
-- before either ran the DELETE, both observe count = 2, both pass the
-- check, and both succeed — leaving the workspace with zero owners.
--
-- Fix (mirrors the atomicity approach F095 used for create_workspace_with_
-- owner, AS-006): move the whole check-and-delete into a single SECURITY
-- DEFINER Postgres function. The count of remaining active owners (after
-- excluding the row being deleted) and the DELETE itself happen inside one
-- function body, which Postgres executes as one implicit transaction with
-- normal MVCC row-level locking on the SELECT ... FOR UPDATE below — a
-- second concurrent invocation blocks on that lock until the first commits
-- or rolls back, so it always sees the post-delete state, not a stale
-- pre-delete count. That removes the race window entirely; no advisory
-- lock or extra round trip from application code is needed.
create or replace function public.remove_workspace_member(
  p_membership_id uuid,
  p_workspace_id uuid
)
returns table (
  deleted boolean,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_status text;
  v_remaining_owners int;
begin
  -- Lock the target row first so concurrent calls targeting the *same* row
  -- serialize on it too (not strictly required for the owner-count race,
  -- but keeps double-delete attempts well-defined).
  select role, status
    into v_role, v_status
    from workspace_members
   where id = p_membership_id
     and workspace_id = p_workspace_id
   for update;

  if not found then
    return query select false, 'not_found';
    return;
  end if;

  if v_status <> 'active' then
    return query select false, 'not_active';
    return;
  end if;

  if v_role = 'owner' then
    -- Lock all active-owner rows for this workspace so a concurrent call
    -- (whether targeting this same owner or a different one) cannot read a
    -- stale count: it blocks here until this transaction commits its
    -- delete (or rolls back), at which point it re-reads the post-delete
    -- row set.
    perform 1
      from workspace_members
     where workspace_id = p_workspace_id
       and role = 'owner'
       and status = 'active'
       for update;

    select count(*)
      into v_remaining_owners
      from workspace_members
     where workspace_id = p_workspace_id
       and role = 'owner'
       and status = 'active';

    if v_remaining_owners <= 1 then
      return query select false, 'sole_owner';
      return;
    end if;
  end if;

  delete from workspace_members
   where id = p_membership_id
     and workspace_id = p_workspace_id
     and status = 'active';

  return query select true, null::text;
end;
$$;

revoke all on function public.remove_workspace_member(uuid, uuid) from public;
grant execute on function public.remove_workspace_member(uuid, uuid) to authenticated, service_role;
