-- F197 (AS-362, AS-364): allow a comment's own author to edit its content.
--
-- Additive per this feature's Clarified "migration safety" answer: adds
-- `edited_at` (nullable timestamptz, null means never edited) alongside
-- the existing `text`/`body_json`/`body_text` columns, no drops.
alter table public.comments
  add column if not exists edited_at timestamptz;

-- Enforcement design note (deviates from the literal "add a plain RLS
-- UPDATE policy scoped to author_id = auth.uid()" wording in the feature
-- spec's Draft scope, recorded here and in the handoff's Decisions made):
--
-- Postgres RLS policies for the same command are combined with OR when
-- permissive (the default kind). `comments` already has
-- `comments_update_author_or_admin` (20260818041550_rls_comments_delete_update.sql),
-- which intentionally allows a workspace admin/owner to UPDATE *any*
-- column of someone else's comment row (needed for delete/restore's
-- deleted_at/deleted_by). RLS operates at row granularity, not column
-- granularity, so a second permissive policy narrowed to
-- `user_id = auth.uid()` would not additionally restrict admins from
-- editing `body_text`/`body_json` — the existing admin-inclusive policy
-- would still independently authorize that same UPDATE statement.
--
-- AS-364 requires that admins (who are "someone else" relative to the
-- comment's author for *editing* purposes, per this feature's clarified
-- "admins deliberately cannot edit other people's words — only delete"
-- answer) are rejected even via a direct API call bypassing the Server
-- Action. The only way to make that column-conditional check hold at the
-- database level — allow admins to change deleted_at/deleted_by, but
-- reject anyone-but-the-author from changing body_text/body_json/text/
-- edited_at — is to compare OLD vs NEW column values, which plain RLS
-- policies cannot do (USING sees only the pre-image, WITH CHECK only the
-- post-image; neither policy clause can reference both in one
-- expression). A BEFORE UPDATE trigger has access to both and is
-- additive to the existing RLS policy rather than replacing it.
--
-- `editComment` (lib/actions/comments.ts) uses the admin (service-role)
-- client, which bypasses RLS but NOT triggers, so the trigger explicitly
-- exempts the service_role — the Server Action has already independently
-- re-verified authorship server-side before issuing that update, same
-- "action is primary enforcement, RLS/trigger is defense in depth for a
-- direct API call using a real user session and the publishable key"
-- convention this file's sibling migrations already establish.
create or replace function public.enforce_comment_edit_author_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service-role callers (the admin client used by every Server Action in
  -- lib/actions/comments.ts) are exempt: authorship has already been
  -- re-verified server-side before this UPDATE is issued.
  if auth.role() = 'service_role' then
    return new;
  end if;

  if (
    new.body_text is distinct from old.body_text
    or new.body_json is distinct from old.body_json
    or new.text is distinct from old.text
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
