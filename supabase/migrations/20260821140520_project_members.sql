-- F132 prerequisite: project_members table + RLS.
--
-- F131 (db-schema-project-members, AS-224) was planned to ship this table
-- ahead of F132, but had not been run yet when this feature started (no
-- migration, no handoff existed for F131 at the time this worker began).
-- F132 cannot implement AS-226 ("private project visible only to its
-- explicit members plus owners/admins") without this join table existing,
-- so this migration ships the minimal version of F131's schema described in
-- its own feature spec (project_id, user_id, project_role, added_by,
-- created_at, unique(project_id, user_id)) as a hard prerequisite. This
-- migration does NOT claim AS-224 — no membership-management Server Action
-- or UI is added here, only the table and its RLS. See this feature's
-- handoff (F132) "Out-of-scope work needed" for what F131 still owns.
--
-- RLS follows the same workspace-membership-join convention as every other
-- table in this codebase (tech-decisions.md).

create table if not exists project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id),
  user_id uuid not null references auth.users (id),
  project_role text not null default 'member' check (project_role in ('lead', 'member')),
  added_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint project_members_unique_project_user unique (project_id, user_id)
);

create index if not exists project_members_project_id_idx on project_members (project_id);
create index if not exists project_members_user_id_idx on project_members (user_id);

alter table project_members enable row level security;

-- SELECT: any active member of the project's workspace can see who is on
-- the project's explicit member list (this mirrors is_project_workspace_member,
-- not is_project_visible_to, deliberately: a workspace member who is
-- deciding whether to request access to a private project, or an
-- owner/admin auditing membership, needs to be able to see the member list
-- even for a private project they are not themselves a member of).
create policy project_members_select_active_members
  on project_members
  for select
  to authenticated
  using (
    public.is_project_workspace_member(project_id)
  );

-- INSERT/DELETE: only workspace owners/admins, or an existing project lead,
-- may add or remove a project member.
create or replace function public.is_project_lead_or_workspace_admin(target_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role in ('owner', 'admin')
  )
  or exists (
    select 1
    from project_members pm
    where pm.project_id = target_project_id
      and pm.user_id = auth.uid()
      and pm.project_role = 'lead'
  );
$$;

revoke all on function public.is_project_lead_or_workspace_admin(uuid) from public;
grant execute on function public.is_project_lead_or_workspace_admin(uuid) to authenticated, anon;

create policy project_members_insert_leads_or_admins
  on project_members
  for insert
  to authenticated
  with check (
    public.is_project_lead_or_workspace_admin(project_id)
  );

create policy project_members_delete_leads_or_admins
  on project_members
  for delete
  to authenticated
  using (
    public.is_project_lead_or_workspace_admin(project_id)
  );

-- No policy is created for anon or for authenticated non-members: absence
-- of a matching policy means those rows are simply not returned/writable
-- (RLS default deny).
