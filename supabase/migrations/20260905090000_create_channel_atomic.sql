-- W7e (missions/20260828-hardening/w7-atomicity-triage.md, Tier 2): closes
-- the hand-rolled compensation gap in `createChannel`
-- (lib/actions/chat-channels.ts).
--
-- Before this migration, createChannel inserted the `channels` row, then
-- inserted the `channel_members` rows; if the member insert failed it issued
-- a *compensating* `delete` on the channel row it had just created. That
-- delete was itself an unguarded network write with no retry and no
-- escalation beyond a `console.error` -- if it also failed (network blip,
-- pooler timeout, anything), the result is an orphan channel with no
-- members: invisible to everyone, undeletable through the UI, counted by
-- nothing.
--
-- Fix: move both inserts into a single SECURITY DEFINER function. A
-- function body runs inside one implicit transaction, so if the
-- channel_members insert fails, Postgres rolls back the channels insert too
-- -- atomic with no manual rollback step, mirroring
-- `create_workspace_with_owner` (20260817234323_workspace_create_rpc.sql)
-- and `transfer_workspace_ownership`
-- (20260822085141_transfer_workspace_ownership_atomic.sql).
--
-- Unlike `create_workspace_with_owner`, this function is invoked through the
-- admin/service-role client (createChannel already independently
-- re-verifies workspace membership and project visibility before calling
-- it, same rationale documented at the top of chat-channels.ts), so the
-- creator id and member ids are passed explicitly as arguments rather than
-- read from auth.uid().
create or replace function public.create_channel_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_kind text,
  p_name text,
  p_created_by uuid,
  p_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel_id uuid;
begin
  insert into channels (workspace_id, project_id, kind, name, created_by)
  values (p_workspace_id, p_project_id, p_kind, p_name, p_created_by)
  returning id into v_channel_id;

  insert into channel_members (channel_id, user_id)
  select v_channel_id, member_id
    from unnest(p_member_ids) as member_id;

  return v_channel_id;
end;
$$;

revoke all on function public.create_channel_atomic(uuid, uuid, text, text, uuid, uuid[]) from public;
grant execute on function public.create_channel_atomic(uuid, uuid, text, text, uuid, uuid[]) to authenticated, service_role;
