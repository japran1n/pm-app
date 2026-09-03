-- F002b (missions/20260903-portal): `create_channel_atomic`'s
-- `p_project_id` and `p_name` parameters have no default, so `supabase gen
-- types typescript` emits them as required, non-nullable `string` in the
-- generated `Args` type -- even though the columns they're written into
-- (`channels.project_id`, `channels.name`) are both nullable, and the
-- function body has always accepted SQL NULL for either at runtime (a DM
-- thread has no `project_id`; a DM "channel" row has no `name`). PostgREST
-- calls RPCs with a named-argument JSON body, so this has worked correctly
-- at runtime all along -- the generated Args type is just wrong.
--
-- This is the same generator limitation `create_notification`
-- (20260823020000_create_notifications.sql) already works around, by
-- declaring `p_actor_id`/`p_task_id`/`p_comment_id` with `default null`,
-- which the generator reflects as an optional Args field. Its caller
-- (lib/notifications/create-notification.ts) then conditionally spreads
-- those keys in rather than ever assigning them `null` directly. Applying
-- the same pattern here lets lib/actions/chat-channels.ts do the same,
-- restoring `npx tsc --noEmit` to a clean state without a cast, an `any`,
-- or a `@ts-expect-error`.
--
-- Postgres requires defaultable parameters to trail every parameter
-- without a default, so `p_project_id`/`p_name` move to the end of the
-- parameter list. That changes the function's argument-type signature, so
-- `create or replace function` (same signature) can't be used -- the old
-- overload is dropped first and the new one created in its place. Calls
-- from PostgREST/supabase-js already pass a named-argument JSON object
-- (see chat-channels.ts), never positional SQL arguments, so parameter
-- order carries no behavioural meaning for any existing caller. Body,
-- return type, volatility are otherwise byte-identical to the live
-- definition; grants are re-declared explicitly since `drop function`
-- does not preserve them.
drop function if exists public.create_channel_atomic(uuid, uuid, text, text, uuid, uuid[]);

create function public.create_channel_atomic(
  p_workspace_id uuid,
  p_kind text,
  p_created_by uuid,
  p_member_ids uuid[],
  p_project_id uuid default null,
  p_name text default null
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

revoke all on function public.create_channel_atomic(uuid, text, uuid, uuid[], uuid, text) from public;
grant execute on function public.create_channel_atomic(uuid, text, uuid, uuid[], uuid, text) to authenticated, service_role;
