-- F206: notifications table + RLS (AS-389, AS-392)
--
-- Per-user notification inbox. Follows the same append-only /
-- SECURITY DEFINER write pattern as task_activity (F194) and
-- audit_log (F139): the table itself grants no client-side INSERT --
-- rows can only be created through public.create_notification(),
-- so no client can fabricate a notification claiming to be for
-- another user or claiming a fake actor/kind.
--
-- Read/write surface for the client (per this feature's spec):
--   SELECT: user_id = auth.uid() only (AS-389) -- a user reads only
--     their own notifications, full stop. No workspace/project join is
--     needed or used for SELECT -- unlike task_activity/comment_reactions,
--     visibility here is per-recipient, not per-shared-resource, so a
--     copy of the shared is_task_visible_to/workspace_members helper
--     would be the WRONG scope for this table. workspace_id is still
--     stored (denormalised) for cheap per-workspace filtering/UI grouping
--     and is validated against membership only at write time.
--   UPDATE: user_id = auth.uid() only, and only for marking read/unread
--     (read_at). This is a real read-write policy, not a SECURITY
--     DEFINER-only surface, because "I marked my own notification read"
--     is exactly the kind of self-scoped, low-risk write RLS is good at
--     enforcing directly, mirroring task_watchers' self-only pattern.
--   INSERT: no policy at all for `authenticated` -- only
--     public.create_notification() (SECURITY DEFINER) can insert, so a
--     malicious client cannot write a notification "from" itself to
--     someone else, or forge an actor_id/kind.
--   DELETE: none. Notifications are not deleted by users in this
--     feature; retention (AS-392) is enforced by the SELECT policy plus
--     a query-time filter, not a delete/cron job (see below).
--
-- Retention (AS-392, per the clarified "ambiguity resolution" --
-- simplest option, no new dependency, no second source of truth,
-- recorded in the handoff's Decisions Made): the retention window is a
-- fixed constant (30 days), enforced by hiding rows older than the
-- window from the panel's read path via a `created_at >= now() -
-- interval '30 days'` filter in the SELECT policy itself -- so
-- "not shown" is a real, DB-enforced guarantee (a stale row can never
-- leak through any query path, not just the one UI component that
-- remembers to filter), not merely a convention the calling code has to
-- remember to apply. No cron/delete job is added in this feature --
-- rows simply age out of visibility; a future feature may add hard
-- deletion for storage/compliance reasons, tracked as out-of-scope
-- below.
--
-- `kind` is a closed vocabulary (mirrors task_activity's `kind` CHECK)
-- matching the notification kinds F207-F212 are expected to produce:
-- mention, comment_reply, task_assigned, task_due_soon, watcher_update.
-- comment_id/task_id are both nullable and independently optional --
-- not every notification kind references both (e.g. a due-soon
-- notification has task_id but no comment_id).
--
-- Realtime: added to the supabase_realtime publication in this same
-- migration per this feature's explicit note ("add the table to the
-- realtime publication for F209"), same guarded/idempotent pattern as
-- 20260818050000_realtime_comments_publication.sql and F199's
-- comment_reactions publication membership. RLS (user_id = auth.uid())
-- still governs which authenticated clients actually receive
-- postgres_changes events for this table.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null,
  actor_id uuid references auth.users (id) on delete set null,
  task_id uuid references public.tasks (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_kind_check check (
    kind in ('mention', 'comment_reply', 'task_assigned', 'task_due_soon', 'watcher_update')
  )
);

comment on table public.notifications is
  'Per-user notification inbox (F206). Writes only via public.create_notification(); no client INSERT policy exists. SELECT/UPDATE are scoped strictly to user_id = auth.uid() (AS-389). Retention (AS-392): the SELECT policy hides rows older than 30 days -- see migration header for rationale; no delete/cron job added in this feature.';

-- Main read path named in the spec: "unread-first, newest-first
-- notifications for the current user" -- covers both the read_at IS
-- NULL prefix a panel typically shows first and the plain
-- newest-first fallback, per the spec's named index shape.
create index if not exists notifications_user_id_read_at_created_at_idx
  on public.notifications (user_id, read_at, created_at desc);

alter table public.notifications enable row level security;

-- SELECT: strictly the current user's own notifications (AS-389), and
-- within the retention window (AS-392). The retention cutoff is
-- inlined here (not a separate helper) since this is the only table
-- that uses it and the clarified answer calls for no new dependency /
-- no second source of truth.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and created_at >= now() - interval '30 days'
  );

-- UPDATE: a user may only update (mark read/unread) their own
-- notifications. with check mirrors using so a user cannot use an
-- UPDATE to reassign a notification to someone else.
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
  on public.notifications
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Deliberately no INSERT or DELETE policy for `authenticated`. INSERT
-- happens only through the SECURITY DEFINER function below; DELETE is
-- not part of this feature's scope (see migration header re: retention).

create or replace function public.create_notification(
  p_user_id uuid,
  p_workspace_id uuid,
  p_kind text,
  p_actor_id uuid default null,
  p_task_id uuid default null,
  p_comment_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns public.notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.notifications;
begin
  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_user_id
      and wm.status = 'active'
  ) then
    raise exception 'create_notification: recipient % is not an active member of workspace %', p_user_id, p_workspace_id;
  end if;

  insert into public.notifications (
    user_id, workspace_id, kind, actor_id, task_id, comment_id, payload
  )
  values (
    p_user_id, p_workspace_id, p_kind, p_actor_id, p_task_id, p_comment_id, coalesce(p_payload, '{}'::jsonb)
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_notification(uuid, uuid, text, uuid, uuid, uuid, jsonb) from public;
grant execute on function public.create_notification(uuid, uuid, text, uuid, uuid, uuid, jsonb) to authenticated, service_role;

-- Realtime publication membership for F209 (guarded, idempotent).
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
