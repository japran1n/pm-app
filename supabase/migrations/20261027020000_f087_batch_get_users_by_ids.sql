-- F087 (accessibility/perf audit item 7): lib/queries/people.ts's
-- resolvePeople() calls `auth.admin.getUserById(id)` once PER id inside a
-- `Promise.all` for every id missing a `profiles.display_name` yet. It's
-- imported by chat, notifications, task-activity, trash, projects,
-- client-requests and templates, so an activity feed with many
-- not-yet-named users fans out into dozens of parallel Admin API calls.
--
-- The GoTrue Admin API has no bulk "get users by ids" endpoint
-- (`auth.admin.listUsers()` only supports page/perPage, not an id
-- filter — @supabase/auth-js's GoTrueAdminApi.d.ts) and PostgREST does
-- not expose the `auth` schema to `.from()`/`.schema()` calls by default,
-- so a single batched lookup needs a SECURITY DEFINER RPC in `public`
-- that reads `auth.users` directly — the same shape
-- `public.shares_workspace_with` (20260818200946_create_profiles.sql) and
-- `handle_new_user`'s own backfill (`select id, 'UTC' from auth.users`,
-- same file) already use for reading `auth.users` from a definer
-- function.
--
-- Granted to `service_role` only (matches
-- 20260822220000_purge_task_and_comment.sql's `purge_task`/
-- `purge_comment` and 20260819071821_subtask_cascade_delete.sql's
-- `cascade_delete_task` — every other service-role-only admin RPC in this
-- schema uses the identical "security definer + grant to service_role
-- only" pattern) since `resolvePeople` always calls it through
-- `createAdminClient()` (lib/supabase/admin.ts), never a session client;
-- `authenticated`/`anon` get no grant, so this RPC cannot be used to
-- enumerate arbitrary users' emails from the browser.
create or replace function public.get_users_by_ids(p_ids uuid[])
returns table (id uuid, email text, raw_user_meta_data jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.email, u.raw_user_meta_data
  from auth.users u
  where u.id = any(p_ids);
$$;

grant execute on function public.get_users_by_ids(uuid[]) to service_role;
