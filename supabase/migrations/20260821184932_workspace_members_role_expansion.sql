-- F126 (AS-215, AS-238): widen the workspace_members.role domain to include
-- 'viewer' and 'guest', and let an invite carry the role it grants on
-- acceptance.
--
-- Background: workspace_members.role was created (20260817222532_create_
-- workspaces.sql) with `check (role in ('owner', 'admin', 'member'))`. The
-- validation contract's AS-215 already names a fourth role, 'viewer', that
-- was never actually enforced in the database, and this feature's own scope
-- adds a fifth, 'guest' (whose scoping/enforcement rules land later, in
-- F134 — this migration only widens the allowed domain). This is purely
-- additive: no existing row's role value changes, and every value that was
-- previously valid (owner/admin/member) remains valid.
--
-- Constraint identity: the original check was declared inline on the
-- column with no explicit name, so Postgres assigned the default naming
-- convention `<table>_<column>_check`. `drop constraint if exists` guards
-- against a name mismatch (e.g. if a prior migration ever renamed it)
-- rather than failing the push outright.
alter table public.workspace_members
  drop constraint if exists workspace_members_role_check;

alter table public.workspace_members
  add constraint workspace_members_role_check
  check (role in ('owner', 'admin', 'member', 'viewer', 'guest'));

-- AS-238: an invite specifies the role granted on acceptance. The existing
-- invite flow (lib/actions/workspaces.ts `inviteMember`) already writes a
-- single `role` column at invite-creation time (status = 'invited') and the
-- accept path (lib/actions/invites.ts `activateInvitedMemberships`) only
-- flips `user_id`/`status` on that same row — it never touches `role`. So
-- the role the row is created with *is* the role granted on acceptance
-- already; no second `invited_role` column is introduced here, which would
-- otherwise create two sources of truth for the same fact that would need
-- to be kept in sync. `inviteMember` is updated (application layer, not
-- this migration) to accept the intended role instead of hardcoding
-- 'member'. See the F126 handoff for the full rationale.
