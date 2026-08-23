-- F211: notification_preferences table + RLS (AS-391, AS-396)
--
-- One row per user, self-owned and self-written — unlike notifications
-- (F206), which is written by another party (an actor) about you and
-- therefore needed a SECURITY DEFINER RPC, a preferences row is data a
-- user directly owns and writes about themselves. Per this feature's
-- clarified "ambiguity resolution" answer (simpler option, no new
-- dependency, no second source of truth), that means plain self-scoped
-- RLS (mirroring profiles_update_self in
-- 20260818200946_create_profiles.sql) is enough here; no SECURITY
-- DEFINER function is needed for the write path the way
-- create_notification needed one.
--
-- Shape: one boolean column per (kind, channel) pair, covering the five
-- kinds notifications.kind's CHECK constraint already recognises
-- (mention, comment_reply, task_assigned, task_due_soon, watcher_update —
-- see 20260823020000_create_notifications.sql). task_due_soon has no
-- producer yet (that's F212), but the column exists now so F212 has
-- something to consult without a second migration, per this feature's
-- spec note.
--
-- Plus one master `email_enabled` switch (AS-396: "turn email off
-- entirely and then receives none") that overrides every per-kind email
-- column when false — a single obvious kill switch, rather than requiring
-- a user to individually disable every per-kind email box to achieve
-- "no email at all". F207's fan-out call sites (this feature's actual
-- wiring) only consult the per-kind *_in_app columns today (in-app is the
-- only channel with a real sender — F206/F209's realtime panel); the
-- *_email columns and email_enabled exist so F215 (email sender, HTML
-- currently [SKIPPED] per this mission's plan.md — Resend isn't
-- connected) has a real column to read from the day it lands, instead of
-- needing its own schema migration. Full end-to-end "receives no email"
-- proof is blocked on F215 existing; see this feature's handoff for the
-- explicit note.
--
-- Defaults (this feature's Notes: "pick defaults that will not make the
-- app feel spammy on day one" — the worker's call to make, recorded here
-- and in the handoff): kinds that name/target the recipient specifically
-- (mention, task_assigned) default to true for BOTH channels — being
-- personally named or assigned is high-signal, not spam. Kinds that are
-- broader activity-stream updates on something the user is already
-- watching (comment_reply, watcher_update, task_due_soon) default to true
-- for in-app (watching is itself an opt-in signal, so an in-app update is
-- expected) but false for email, so a new user's inbox does not fill up
-- with email for every comment on every task they happen to watch.
create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,

  mention_in_app boolean not null default true,
  mention_email boolean not null default true,

  task_assigned_in_app boolean not null default true,
  task_assigned_email boolean not null default true,

  comment_reply_in_app boolean not null default true,
  comment_reply_email boolean not null default false,

  watcher_update_in_app boolean not null default true,
  watcher_update_email boolean not null default false,

  task_due_soon_in_app boolean not null default true,
  task_due_soon_email boolean not null default false,

  email_enabled boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notification_preferences is
  'Per-user notification preferences (F211). One row per user, self-owned and self-written via plain RLS (no SECURITY DEFINER function needed, unlike notifications). Per-kind in-app/email booleans plus a master email_enabled kill switch (AS-396). F207''s fan-out call sites consult the *_in_app columns; the *_email columns and email_enabled are consulted by F215 (email sender), currently [SKIPPED].';

-- Reuses set_updated_at(), established in 20260818004413_create_projects.sql.
drop trigger if exists notification_preferences_set_updated_at on public.notification_preferences;
create trigger notification_preferences_set_updated_at
  before update on public.notification_preferences
  for each row
  execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- A preferences row is created automatically on first sign-in, same
-- auto-create-on-auth.users-insert pattern as profiles
-- (handle_new_user/on_auth_user_created in
-- 20260818200946_create_profiles.sql) — a deliberately separate trigger
-- function/name rather than editing that migration's existing function,
-- per this feature's scope boundary (stay inside the files this feature's
-- spec names).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_notification_preferences on auth.users;
create trigger on_auth_user_created_notification_preferences
  after insert on auth.users
  for each row
  execute function public.handle_new_user_notification_preferences();

-- Backfill: any user that signed up before this migration ran gets a
-- default preferences row too (this feature's "sensible defaults for
-- existing users" note, and the clarified "migration safety: additive,
-- backfilled" answer). Safe to re-run — `on conflict` no-ops for rows
-- already backfilled.
-- This mission's Supabase project has accumulated a large number of
-- auth.users rows from prior features' integration test suites, some of
-- which do not always clean up after themselves; the default migration
-- statement_timeout is too short for a full-table backfill insert against
-- that many rows, so it is raised for this statement only (scoped to this
-- transaction via `set local`, not a global change).
set local statement_timeout = '300s';

insert into public.notification_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;

alter table public.notification_preferences enable row level security;

-- SELECT: a user reads only their own preferences row.
drop policy if exists notification_preferences_select_own on public.notification_preferences;
create policy notification_preferences_select_own
  on public.notification_preferences
  for select
  to authenticated
  using (user_id = auth.uid());

-- INSERT: a user may create only their own row (defensive — the trigger
-- above already guarantees one exists for every signed-up user; this
-- exists so a client-side upsert against a row that somehow doesn't exist
-- yet still succeeds rather than silently failing).
drop policy if exists notification_preferences_insert_own on public.notification_preferences;
create policy notification_preferences_insert_own
  on public.notification_preferences
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- UPDATE: a user may update only their own row; `with check` mirrors
-- `using` so an UPDATE can never reassign a row to a different user_id,
-- same shape as profiles_update_self.
drop policy if exists notification_preferences_update_own on public.notification_preferences;
create policy notification_preferences_update_own
  on public.notification_preferences
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No DELETE policy: preferences are not deleted by users in this feature
-- (cascades away automatically via `on delete cascade` if the auth.users
-- row itself is ever deleted). Absence of a DELETE policy denies it by
-- default under RLS.

-- No policy for other users or anon: absence of a matching policy means
-- those reads return zero rows rather than an error, matching every other
-- self-scoped table's convention in this schema (notifications, task
-- reactions, etc.) — a preferences row is never visible to anyone but its
-- owner, unlike profiles which has a shared-workspace SELECT carve-out.
