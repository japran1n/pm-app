-- F061: narrowly-scoped UPDATE policy for comment soft-delete
-- (AS-098, AS-099, AS-100).
--
-- Per 20260818040214_create_comments.sql's trailing comment, this
-- migration adds exactly the UPDATE policy that migration deliberately
-- left out: author-of-the-comment OR workspace admin/owner may update a
-- comment row. In practice `deleteComment` (lib/actions/comments.ts) only
-- ever sets `deleted_at`, but this is RLS defense-in-depth, not the
-- primary enforcement — the Server Action re-checks author/role itself
-- before ever reaching this policy (using the admin client, which bypasses
-- RLS entirely). The policy exists so a direct API call against the
-- publishable key with a real user session is bound by the same rule.
--
-- Mirrors public.is_task_workspace_member's join shape but adds an
-- author-or-admin predicate on top, since plain membership (any role) is
-- not sufficient here the way it is for comments_insert_active_members.
create or replace function public.can_modify_comment(target_comment_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from comments c
    join tasks t on t.id = c.task_id
    join projects p on p.id = t.project_id
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where c.id = target_comment_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and (
        c.user_id = auth.uid()
        or wm.role in ('owner', 'admin')
      )
  );
$$;

revoke all on function public.can_modify_comment(uuid) from public;
grant execute on function public.can_modify_comment(uuid) to authenticated, anon;

-- UPDATE: only the comment's own author, or an active workspace admin/owner
-- of the workspace that (transitively) owns the comment's task, may update
-- a comment row (AS-098, AS-099, AS-100). `with check` re-validates the
-- same predicate against the resulting row so a caller cannot use an
-- UPDATE to reassign a comment to bypass this rule.
create policy comments_update_author_or_admin
  on comments
  for update
  to authenticated
  using (public.can_modify_comment(id))
  with check (public.can_modify_comment(id));
