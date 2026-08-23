-- F302 follow-up (AS-364, FU-5): the BEFORE UPDATE trigger added in
-- 20260823000000_comment_edit.sql (public.enforce_comment_edit_author_only)
-- only compares auth.uid() to OLD.user_id, and never guards NEW.user_id or
-- edited_at. That means a workspace admin (who is independently authorized
-- to UPDATE any comment row by the pre-existing
-- comments_update_author_or_admin RLS policy, for the deleted_at/
-- deleted_by delete/restore flow) can, via two direct API calls:
--
--   1. UPDATE comments SET user_id = <self> WHERE id = <someone else's>;
--      -- rejected by nothing: the trigger only checked auth.uid() vs
--      -- OLD.user_id, and body_text/body_json/text did not change in
--      -- this call, so the trigger's guard never fired at all.
--   2. UPDATE comments SET body_text = '...' WHERE id = <same row>;
--      -- now OLD.user_id already equals auth.uid() (from step 1), so
--      -- the trigger's existing check passes trivially.
--
-- ...ending with another user's comment silently reassigned to the
-- admin and its content rewritten, displaying as if the admin (or worse,
-- anyone the admin then reassigns it to) had always authored it. The
-- trigger also never guarded a client-supplied edited_at value, so a
-- non-author could stamp an arbitrary edited_at on a row via a direct
-- UPDATE even without going through editComment.
--
-- Fix: extend the same BEFORE UPDATE trigger (still exempting
-- service_role, since lib/actions/comments.ts's editComment/
-- deleteComment/restoreComment already re-verify authorship/permissions
-- server-side before issuing their UPDATEs via the admin client) to also
-- reject:
--
--   (a) ANY change to user_id at all, by anyone, ever -- authorship can
--       never be reassigned through this path. This is not conditioned
--       on auth.uid(): even the row's own author cannot reassign their
--       own comment to someone else, and an admin (whose row-level
--       UPDATE grant this trigger does not revoke) still cannot either.
--   (b) A non-author change to edited_at -- mirrors the existing
--       body_text/body_json/text guard rather than trying to fully
--       remove edited_at from client control, since editComment (the
--       only legitimate, non-service-role... actually service-role...
--       caller) already sets it correctly and no other code path should
--       be touching it.
--
-- create or replace is safe here: same trigger function signature
-- (returns trigger, no arguments), same trigger definition below.
create or replace function public.enforce_comment_edit_author_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service-role callers (the admin client used by every Server Action in
  -- lib/actions/comments.ts) are exempt: authorship/permissions have
  -- already been re-verified server-side before this UPDATE is issued.
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Authorship can never be reassigned via a direct UPDATE, by anyone,
  -- regardless of which columns are also changing in the same statement.
  -- This closes the two-step "set user_id to self, then rewrite body"
  -- takeover: step 1 alone (a bare user_id change) is now rejected
  -- outright, so there is no window in which OLD.user_id has already
  -- become the attacker's own id before the body-change guard below ever
  -- runs.
  if new.user_id is distinct from old.user_id then
    raise exception 'Comment authorship cannot be reassigned'
      using errcode = '42501';
  end if;

  if (
    new.body_text is distinct from old.body_text
    or new.body_json is distinct from old.body_json
    or new.text is distinct from old.text
    or new.edited_at is distinct from old.edited_at
  ) and auth.uid() is distinct from old.user_id then
    raise exception 'Only the comment author may edit its content'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists comments_edit_author_only on public.comments;
create trigger comments_edit_author_only
  before update on public.comments
  for each row
  execute function public.enforce_comment_edit_author_only();
