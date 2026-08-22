-- F199: comment_reactions table + RLS (AS-365, AS-368, AS-370)
--
-- Lets a user react to a comment with one of a small closed set of
-- emoji. Shape per the clarified "data shape" answer: snake_case
-- columns, no surrogate id -- the composite primary key
-- (comment_id, user_id, emoji) IS the identity, and is what makes
-- AS-368 ("one reaction per emoji per comment per user") a real DB-level
-- guarantee rather than only an app-layer check: a second insert of the
-- same (comment_id, user_id, emoji) tuple is rejected by the PK, full
-- stop, regardless of what the calling code does.
--
-- Access control (per the clarified "auth" answer -- reuse the shared
-- helper, not a copy-pasted predicate): SELECT/INSERT/DELETE are all
-- scoped through public.is_task_visible_to(task_id), joined from the
-- comment's task_id, exactly as F132 (checklist_items), F159
-- (task_assignees) and F163 (task_watchers) already do. INSERT/DELETE
-- additionally require user_id = auth.uid() -- per the feature spec,
-- nobody may react (or remove a reaction) on someone else's behalf, so
-- this is narrower than a plain "any visible-task member" predicate, the
-- same shape as task_watchers' self-only write policies.
--
-- Cascade / soft-delete (per this feature's Notes-for-clarification,
-- resolved by taking the simpler option per the clarification's
-- "ambiguity resolution" answer -- see handoff Decisions Made):
-- `on delete cascade` from comments handles AS-370 structurally for a
-- HARD delete (e.g. the F220 purge job). Comments are normally
-- soft-deleted (comments.deleted_at), which does NOT trigger this FK
-- cascade -- reaction rows for a soft-deleted comment simply become
-- unreadable via the SELECT policy below (same is_task_visible_to gate
-- the comment itself uses; the comments_select_active_members policy on
-- `comments` already hides deleted_at is not null rows from readers, and
-- any UI reading reactions does so joined off a comment the reader can
-- already see). This mirrors task_activity's simpler-wins precedent of
-- not inventing a second cleanup path for something visibility rules
-- already handle, and keeps this migration purely additive.
--
-- emoji allow-list (per "Restrict emoji to a small allow-list" in the
-- spec, no exact list given in the clarification, so a common minimal
-- reaction set was chosen -- see handoff Decisions Made): thumbsup,
-- heart, laugh, tada, eyes, rocket -- represented as the literal emoji
-- characters (matches what a picker UI would send directly, no extra
-- name<->emoji mapping table needed, and there is no dependency added).
--
-- Realtime: added to the same `supabase_realtime` publication `comments`
-- already uses (mirrors 20260818050000_realtime_comments_publication.sql)
-- so F202's live-reactions feature has the plumbing in place; RLS
-- (is_task_visible_to via the SELECT policy below) still governs which
-- authenticated clients actually receive postgres_changes events for
-- this table, same as the `comments` table's own publication membership.

create table if not exists comment_reactions (
  comment_id uuid not null references comments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id, emoji),
  constraint comment_reactions_emoji_allowlist check (
    emoji in ('👍', '❤️', '😄', '🎉', '👀', '🚀')
  )
);

-- Index strategy: comment_id is already the leading column of the
-- primary key (covers "reactions for comment X"). A second index on
-- user_id covers any future "reactions by user" query, mirroring
-- task_watchers' user_id index precedent.
create index if not exists comment_reactions_user_id_idx on comment_reactions (user_id);

comment on table comment_reactions is
  'Emoji reactions on comments (F199). One reaction per (comment, user, emoji) enforced by the composite primary key (AS-368). Cascades on comment HARD delete (AS-370); soft-deleted comments'' reactions become invisible via the same is_task_visible_to/comments_select_active_members visibility path the comment itself uses, not a separate cleanup step. emoji is restricted to a fixed allow-list via CHECK.';

alter table comment_reactions enable row level security;

-- SELECT: any user who can see the comment's task may see its reactions.
-- Joins comment_reactions -> comments -> task_id -> is_task_visible_to,
-- reusing the shared helper per this feature's explicit instruction.
drop policy if exists comment_reactions_select_visible on comment_reactions;
create policy comment_reactions_select_visible
  on comment_reactions
  for select
  to authenticated
  using (
    exists (
      select 1
      from comments c
      where c.id = comment_reactions.comment_id
        and public.is_task_visible_to(c.task_id)
    )
  );

-- INSERT: a user may only add a reaction as themselves, and only on a
-- comment whose task they can see.
drop policy if exists comment_reactions_insert_self on comment_reactions;
create policy comment_reactions_insert_self
  on comment_reactions
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from comments c
      where c.id = comment_reactions.comment_id
        and public.is_task_visible_to(c.task_id)
    )
  );

-- DELETE: a user may only remove their own reaction. No visibility
-- re-check is needed on delete (mirrors task_watchers_delete_self) --
-- if the row exists and belongs to them, they may remove it.
drop policy if exists comment_reactions_delete_self on comment_reactions;
create policy comment_reactions_delete_self
  on comment_reactions
  for delete
  to authenticated
  using (
    user_id = auth.uid()
  );

-- Realtime publication membership for F202 (guarded, idempotent — same
-- pattern as 20260818050000_realtime_comments_publication.sql).
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'comment_reactions'
  ) then
    alter publication supabase_realtime add table public.comment_reactions;
  end if;
end
$$;
