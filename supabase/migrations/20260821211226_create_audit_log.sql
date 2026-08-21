-- F139: audit_log table + append-only RLS (AS-247, AS-249).
--
-- A workspace-scoped, append-only history of sensitive actions (member
-- role changes, ownership transfers, project archival, etc.). Two
-- properties are load-bearing and enforced at the database layer, not
-- just in the UI:
--
--   1. Read access is owner/admin only (AS-247) — a regular member's
--      direct SELECT against this table (bypassing the Server Action
--      layer entirely, using their own real session) must return zero
--      rows, not an error, mirroring the existing RLS convention used
--      throughout this schema (e.g. active_timers, comments).
--
--   2. The table is genuinely append-only (AS-249) — there is no UPDATE
--      or DELETE RLS policy defined at all, for any role, including
--      owner/admin. This is deliberate: "no UI for it" is not the same
--      guarantee as "no policy permits it". Even a compromised owner/
--      admin session (real session, not the service-role admin client)
--      cannot alter or erase history via a direct Postgres call.
--
-- Writes happen exclusively through the SECURITY DEFINER function
-- `public.write_audit_log_entry` below. Application code (Server
-- Actions) calls this RPC; there is intentionally no INSERT policy that
-- lets an authenticated client's own publishable-key session insert a
-- row directly. That closes the "a malicious/compromised client session
-- forges an audit entry claiming to be someone else" hole a plain
-- `actor_id = auth.uid()`-scoped INSERT policy would still leave open
-- (a compromised session could still write *a* row, just not impersonate
-- another actor — but this design removes that surface entirely: only
-- server-side code with a validated actor from the authenticated session
-- may call the RPC, and the RPC itself pins `actor_id` to `auth.uid()`
-- rather than trusting a client-supplied value).
--
-- --- action naming convention -------------------------------------------
--
-- `action` is a free-form `text` column, not an enum. An enum would force
-- a schema migration for every new logged action type, which does not
-- scale as more features (F140 onward) add audit entries. Instead, all
-- callers MUST follow this convention (documented here and mirrored in
-- lib/activity/README.md for discoverability from application code):
--
--   "<subject>.<past_tense_verb>[_<qualifier>]"
--
-- - `<subject>` is the lowercase, singular name of the primary entity
--   the action happened to: `project`, `member`, `workspace`, `task`,
--   `invite`, etc.
-- - `<past_tense_verb>` describes what happened, past tense, snake_case
--   if multi-word: `archived`, `restored`, `role_changed`,
--   `ownership_transferred`, `removed`, `created`, `deleted`.
-- - An optional `_<qualifier>` suffix disambiguates variants of the same
--   verb on the same subject (e.g. `member.role_changed` needs no
--   qualifier because the metadata jsonb column carries the before/after
--   roles; a hypothetical `invite.revoked_expired` vs
--   `invite.revoked_manual` would use one).
--
-- Examples: `project.archived`, `project.restored`, `member.role_changed`,
-- `member.removed`, `workspace.ownership_transferred`.
--
-- `target_type` names the table/entity the action's `target_id` points
-- into (e.g. `'project'`, `'workspace_member'`), and `metadata` carries
-- any additional structured detail (before/after values, reason, etc.)
-- as jsonb — never encode detail into `action` itself beyond the
-- qualifier suffix above.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  target_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_log is
  'Append-only workspace audit trail (F139). Writes only via public.write_audit_log_entry(); no UPDATE/DELETE policy exists for any role. See migration header comment for the action-naming convention (subject.past_tense_verb[_qualifier]).';

-- Main read path: "audit log for workspace X, most recent first" — the
-- query the workspace audit settings page runs.
create index audit_log_workspace_id_created_at_idx
  on public.audit_log (workspace_id, created_at desc);

-- Secondary read path: "everything actor Y has done", used for
-- per-member activity views.
create index audit_log_actor_id_idx
  on public.audit_log (actor_id);

alter table public.audit_log enable row level security;

-- SELECT: owners/admins of the workspace only (AS-247). Mirrors the
-- owner/admin role check in lib/auth/permissions.ts's canViewAudit, via
-- the same workspace_members join shape used by every other RLS policy
-- in this schema (see is_project_workspace_writer et al.).
create policy audit_log_select_owner_admin
  on public.audit_log
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = audit_log.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    )
  );

-- Deliberately no INSERT/UPDATE/DELETE policy of any kind on this table.
-- INSERT happens only through the SECURITY DEFINER function below, which
-- runs with the privileges of its owner (bypassing RLS internally) —
-- RLS on the table itself need not (and does not) grant INSERT to any
-- role. UPDATE/DELETE are omitted entirely and permanently: this is what
-- makes the table append-only, not just "no UI calls it" (AS-249).

create or replace function public.write_audit_log_entry(
  p_workspace_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns public.audit_log
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.audit_log;
begin
  if auth.uid() is null then
    raise exception 'audit_log: no authenticated actor';
  end if;

  -- The caller must be an active member of the workspace they're logging
  -- an entry for (defense in depth — Server Actions should already be
  -- re-checking membership/role before calling this, but the function
  -- does not blindly trust it either).
  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  ) then
    raise exception 'audit_log: caller is not an active member of this workspace';
  end if;

  insert into public.audit_log (workspace_id, actor_id, action, target_type, target_id, metadata)
  values (p_workspace_id, auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb))
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.write_audit_log_entry(uuid, text, text, uuid, jsonb) from public;
grant execute on function public.write_audit_log_entry(uuid, text, text, uuid, jsonb) to authenticated, service_role;
