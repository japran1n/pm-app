-- F130 (AS-233, AS-234): atomic ownership transfer.
--
-- A transfer is a genuine two-row write (old owner -> admin, new owner ->
-- owner) unlike F129's single-row role-change guard, which used a
-- check-then-act compromise because it only ever mutates one row. A
-- transfer must never be allowed to leave a workspace ownerless,
-- double-owned, or with a torn write if it fails partway through — so this
-- mirrors `remove_workspace_member`'s (F094,
-- 20260817234900_remove_member_atomic_owner_guard.sql) `SELECT ... FOR
-- UPDATE` locking shape: lock both rows first, validate inside the same
-- transaction, then perform both updates together. Postgres runs the whole
-- function body as one implicit transaction, so any rejection before the
-- updates run leaves every row completely untouched (AS-233's atomicity
-- requirement), and a second concurrent call targeting the same workspace's
-- owner row blocks on the lock until this one commits or rolls back.
create or replace function public.transfer_workspace_ownership(
  p_workspace_id uuid,
  p_new_owner_user_id uuid
)
returns table (
  transferred boolean,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_membership_id uuid;
  v_owner_role text;
  v_owner_status text;
  v_target_membership_id uuid;
  v_target_role text;
  v_target_status text;
  v_active_owner_count int;
begin
  -- Lock the current owner's row first (deterministic lock ordering by
  -- role='owner' avoids a lock-order deadlock with a concurrent transfer
  -- attempt in the other direction on the same workspace).
  select id, role, status
    into v_owner_membership_id, v_owner_role, v_owner_status
    from workspace_members
   where workspace_id = p_workspace_id
     and role = 'owner'
     and status = 'active'
   order by created_at asc
   limit 1
     for update;

  if v_owner_membership_id is null then
    return query select false, 'no_active_owner';
    return;
  end if;

  -- Lock the target's row.
  select id, role, status
    into v_target_membership_id, v_target_role, v_target_status
    from workspace_members
   where workspace_id = p_workspace_id
     and user_id = p_new_owner_user_id
   order by created_at asc
   limit 1
     for update;

  if v_target_membership_id is null then
    return query select false, 'target_not_member';
    return;
  end if;

  -- AS-234: the target must be an active (non-removed, non-pending) member
  -- of this exact workspace.
  if v_target_status <> 'active' then
    return query select false, 'target_not_active';
    return;
  end if;

  -- A no-op transfer to the current owner themselves is rejected rather
  -- than silently succeeding — there is nothing to transfer.
  if v_target_membership_id = v_owner_membership_id then
    return query select false, 'target_is_current_owner';
    return;
  end if;

  -- Both writes happen together, inside the same transaction as the locks
  -- and validation above — if either statement fails (e.g. a check
  -- constraint violation), Postgres rolls back the whole function body and
  -- neither row changes.
  update workspace_members
     set role = 'owner'
   where id = v_target_membership_id
     and workspace_id = p_workspace_id;

  update workspace_members
     set role = 'admin'
   where id = v_owner_membership_id
     and workspace_id = p_workspace_id;

  -- Defensive invariant check: exactly one active owner must exist for
  -- this workspace after the transfer. Under normal operation this can
  -- never fail (the two updates above always swap one owner for another),
  -- but if the workspace's data was already in an anomalous state (e.g. a
  -- pre-existing duplicate owner row from a bug elsewhere), completing the
  -- transfer would double the anomaly rather than fix it. Raising here
  -- aborts the whole function body — because this runs inside a single
  -- implicit transaction with no exception handler, Postgres rolls back
  -- BOTH updates above, so the original owner's row is left completely
  -- untouched, not partially updated (AS-233's atomicity requirement).
  select count(*)
    into v_active_owner_count
    from workspace_members
   where workspace_id = p_workspace_id
     and role = 'owner'
     and status = 'active';

  if v_active_owner_count <> 1 then
    raise exception 'transfer_workspace_ownership: invariant violated, expected exactly 1 active owner for workspace %, found %', p_workspace_id, v_active_owner_count;
  end if;

  return query select true, null::text;
end;
$$;

revoke all on function public.transfer_workspace_ownership(uuid, uuid) from public;
grant execute on function public.transfer_workspace_ownership(uuid, uuid) to authenticated, service_role;
