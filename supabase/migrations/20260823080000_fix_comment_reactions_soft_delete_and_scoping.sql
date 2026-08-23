-- F305 (AS-369, AS-370): follow-up from M15 scrutiny FU-6 and FU-7.
--
-- FU-6 / AS-370 -- reactions on a soft-deleted comment stay readable:
-- comment_reactions_select_visible (F199) relied on comments' `on delete
-- cascade` FK to clean up reaction rows when a comment goes away, but
-- comments are SOFT-deleted in production (lib/actions/comments.ts's
-- deleteComment sets `deleted_at`, it never issues a real DELETE), so
-- that cascade never actually fires. The SELECT policy's predicate also
-- omitted the `deleted_at is null` check the comments table's own SELECT
-- policy (comments_select_active_members,
-- 20260821140526_project_visibility_rls_sweep.sql) already has, so
-- reactions on a soft-deleted comment stayed directly readable via
-- PostgREST and kept showing up in the realtime stream. Fixed below by
-- adding the same `c.deleted_at is null` clause to
-- comment_reactions_select_visible, mirroring the comments policy
-- exactly. Policies can't be `create or replace`d -- this repo's own
-- convention (see every `comment_reactions_*`/`comments_*` policy in
-- prior migrations) is `drop policy if exists` + `create policy`, used
-- here too rather than `alter policy` so the whole `using` clause is
-- swapped in one readable statement.
--
-- Restoring a soft-deleted comment (restoreComment in
-- lib/actions/comments.ts) is a deliberate design choice here, not an
-- accident: reactions are never actually deleted by a soft-delete, only
-- hidden by this SELECT policy while deleted_at is set, so once the
-- comment is restored (deleted_at cleared) its prior reactions become
-- visible again automatically with no extra code. This is the desired
-- behaviour -- nothing about restoring a comment should force everyone
-- who reacted to it to re-react.
--
-- FU-7 / AS-369 -- reactions realtime subscription leaks cross-tenant
-- data: the comment_reactions postgres_changes subscription
-- (lib/tasks/subscribe-comments-realtime.ts's subscribeToReactionsRealtime)
-- had no `filter` at all, so every authenticated client received every
-- reaction INSERT/DELETE in the database; because Supabase does not
-- apply RLS to DELETE payloads, an un-react on a comment the subscriber
-- can't see still leaked comment_id/user_id/emoji to them. comment_
-- reactions has no task_id column (an intentional F199 decision), so it
-- can't be filtered server-side the way subscribeToCommentsRealtime
-- already filters `comments` on `task_id=eq.<taskId>`. Fixed here by
-- adding a denormalized, NOT NULL `task_id` column (mirroring the
-- pattern that sibling channel already uses) rather than relying on a
-- client-side `comment_id=in.(...)` filter -- chosen because it stops
-- the leak at the actual transport/RLS-filter level (the real security
-- boundary) instead of only narrowing what the client code chooses to
-- react to, and because postgres_changes' `in.` filter support varies by
-- @supabase/supabase-js/realtime-server version and isn't worth betting
-- the fix on when a plain `eq` column filter is unambiguous and already
-- proven for the sibling `comments` channel.

alter table comment_reactions
  add column if not exists task_id uuid references tasks (id) on delete cascade;

update comment_reactions cr
set task_id = c.task_id
from comments c
where c.id = cr.comment_id
  and cr.task_id is null;

alter table comment_reactions
  alter column task_id set not null;

create index if not exists comment_reactions_task_id_idx
  on comment_reactions (task_id);

-- task_id is not part of the composite primary key (comment_id, user_id,
-- emoji), so by default Postgres' logical replication (what Realtime's
-- postgres_changes reads) would only include primary-key columns in a
-- DELETE event's OLD row -- task_id would be missing from the WAL entry
-- entirely, and a `filter: task_id=eq.<taskId>` on the DELETE
-- subscription below would never match. REPLICA IDENTITY FULL makes the
-- whole OLD row (including task_id) available for DELETE, the same fix
-- 20260818050000_realtime_comments_publication.sql's sibling channel
-- relies on implicitly via comments' own primary key already containing
-- everything that channel filters on -- comment_reactions' PK does not
-- contain task_id, so this table needs it explicit.
alter table comment_reactions replica identity full;

comment on column comment_reactions.task_id is
  'Denormalized from comments.task_id (F305/AS-369) so the comment_reactions realtime subscription can be filtered server-side with `filter: task_id=eq.<taskId>`, the same pattern the comments channel already uses -- without this column, postgres_changes had no way to scope reaction events to a task and every authenticated client received every reaction change in the database.';

-- SELECT: unchanged shape, but now also requires the parent comment to
-- not be soft-deleted, matching comments_select_active_members.
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
        and c.deleted_at is null
        and public.is_task_visible_to(c.task_id)
    )
  );

-- INSERT: additionally require the caller-supplied task_id to actually
-- match the comment's real task_id, so a client can't forge a
-- comment_reactions.task_id that doesn't correspond to comment_id (which
-- would otherwise let a forged task_id smuggle a reaction event onto a
-- realtime channel for a task the row doesn't really belong to).
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
        and c.deleted_at is null
        and c.task_id = comment_reactions.task_id
        and public.is_task_visible_to(c.task_id)
    )
  );

-- DELETE: unchanged (self-only, no visibility re-check needed, mirrors
-- task_watchers_delete_self, same rationale as F199's original policy).
