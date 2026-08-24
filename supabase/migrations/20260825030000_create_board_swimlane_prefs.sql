-- F226 (AS-422, AS-424): board_swimlane_prefs -- per-user, per-project
-- board view preferences: the chosen swimlane grouping mode (AS-424) and,
-- per grouping mode, which lanes are collapsed (AS-422).
--
-- Own-row RLS, same self-scoped pattern as notification_preferences
-- (20260823040000_create_notification_preferences.sql) -- a user reading
-- or writing their OWN preferences row needs no admin client / SECURITY
-- DEFINER RPC, unlike notifications' cross-user write path. Per this
-- feature's clarified "ambiguity resolution" answer (simpler option, no
-- new dependency, no second source of truth), this reuses that exact
-- convention rather than inventing localStorage-based persistence
-- alongside it.
--
-- Unlike notification_preferences (one row per user, auto-created on
-- sign-up), this table is one row per (user, project) and is NOT
-- auto-created -- a user who has never opened a given project's board
-- has no row, and the read path (getBoardSwimlanePrefs,
-- lib/actions/board-prefs.ts) treats "no row" as "groupBy=none,
-- collapsedLanes={}" (the same defaults as today, so an existing board
-- URL with no persisted prefs renders identically to pre-F226).
--
-- collapsed_lanes is stored as a JSON OBJECT keyed by grouping mode
-- (`{"assignee": ["u1","u2"], "priority": ["urgent"], "tag": ["ui"]}`),
-- not a flat array -- so switching grouping mode never carries a stale
-- collapse from one mode into another (a collapsed "urgent" priority lane
-- must not silently collapse a same-named tag lane, and switching away
-- from "assignee" and back must remember that mode's own collapse set
-- untouched by whatever happened under "tag" in between). A lane key that
-- no longer exists (a tag renamed away, an assignee removed from the
-- project) simply never matches any lane rendered today -- the stored key
-- becomes inert, not corrupting, and is silently pruned back down next
-- time that mode's set is written (see upsertBoardSwimlanePrefs's own
-- comment).
create table if not exists public.board_swimlane_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  group_by text not null default 'none'
    check (group_by in ('none', 'assignee', 'priority', 'tag')),
  collapsed_lanes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

comment on table public.board_swimlane_prefs is
  'Per-user, per-project board view preferences (F226): chosen swimlane grouping mode (AS-424) and, per grouping mode, the set of collapsed lane keys (AS-422). No row means defaults (groupBy=none, no collapsed lanes) -- not auto-created, unlike notification_preferences.';

drop trigger if exists board_swimlane_prefs_set_updated_at on public.board_swimlane_prefs;
create trigger board_swimlane_prefs_set_updated_at
  before update on public.board_swimlane_prefs
  for each row
  execute function set_updated_at();

alter table public.board_swimlane_prefs enable row level security;

-- SELECT: a user reads only their own preference rows.
drop policy if exists board_swimlane_prefs_select_own on public.board_swimlane_prefs;
create policy board_swimlane_prefs_select_own
  on public.board_swimlane_prefs
  for select
  to authenticated
  using (user_id = auth.uid());

-- INSERT: a user may create only their own row.
drop policy if exists board_swimlane_prefs_insert_own on public.board_swimlane_prefs;
create policy board_swimlane_prefs_insert_own
  on public.board_swimlane_prefs
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- UPDATE: a user may update only their own row; `with check` mirrors
-- `using` so an UPDATE can never reassign a row to a different user_id,
-- same shape as notification_preferences_update_own.
drop policy if exists board_swimlane_prefs_update_own on public.board_swimlane_prefs;
create policy board_swimlane_prefs_update_own
  on public.board_swimlane_prefs
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No DELETE policy: rows are not deleted by users in this feature (they
-- cascade away automatically via `on delete cascade` on both FKs --
-- project deleted, or the user's own auth.users row deleted). Absence of
-- a DELETE policy denies it by default under RLS.

-- No policy for other users or anon: absence of a matching policy means
-- those reads return zero rows rather than an error, matching
-- notification_preferences' own convention -- a preference row is never
-- visible to anyone but its owner.
