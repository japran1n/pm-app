-- F007 (missions/20260903-portal, M2 — Approvals): a first-class
-- `approval_requests` table, `project_decision_owners`, and
-- `decide_approval_atomic` — the RPC a client's Approve/Request changes
-- click actually reaches.
--
-- Why this shape (spec's own "Why this shape" section): the app already
-- has approvals, but only as a boolean on a task
-- (`tasks.pending_client_approval`, 20260903050000) with
-- `approve_portal_task_atomic` (20260905130000) acting on it. That
-- covers "approve this task" and nothing else the Good Guys process
-- actually puts in front of a client — a sitemap (not a task), a
-- moodboard (not a task), a Figma link (not in this system), a priced
-- change request. `approval_requests` becomes the source of truth;
-- `tasks.pending_client_approval` stays as a denormalised indicator the
-- RPC keeps in sync (NOT deleted — the board and the portal overview
-- both still read it, per the spec's explicit instruction).
--
-- Every SECURITY DEFINER function this migration adds pins
-- `search_path` to `public, pg_temp` from the start — 20260908010000's
-- lesson, not repeated here: an unqualified `set search_path = public`
-- implicitly searches pg_temp FIRST, and `authenticated` has TEMP
-- privileges by default, so a caller could shadow
-- `projects`/`tasks`/`approval_requests`/`project_decision_owners`
-- inside a function body without the explicit pin.

-- ---------------------------------------------------------------------
-- 1. approval_requests
-- ---------------------------------------------------------------------

create table if not exists approval_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  phase_id uuid references project_phases (id) on delete set null,
  subject_type text not null,
  -- Polymorphic id (task/doc/phase — or null for 'artifact'): no FK, same
  -- precedent as audit_log.target_id (20260821211226) for the identical
  -- "points at one of several tables depending on a sibling column"
  -- shape. Validity of `subject_id` for a given `subject_type` is a
  -- read-time/write-time application concern, not a schema one.
  subject_id uuid,
  artifact_url text,
  artifact_snapshot_path text,
  title text not null,
  description text,
  decision_type text not null,
  state text not null default 'pending',
  requested_by uuid not null references auth.users (id),
  requested_at timestamptz not null default now(),
  due_at timestamptz,
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  decision_note text,
  round integer not null default 1,
  supersedes_id uuid references approval_requests (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_requests_subject_type_check check (
    subject_type in ('task', 'doc', 'phase', 'artifact')
  ),
  constraint approval_requests_decision_type_check check (
    decision_type in ('content', 'brand', 'technical', 'commercial')
  ),
  constraint approval_requests_state_check check (
    state in ('pending', 'approved', 'changes_requested', 'withdrawn')
  ),
  constraint approval_requests_title_not_empty check (btrim(title) <> ''),
  -- Spec: "subject_id must be non-null when subject_type <> 'artifact',
  -- and artifact_url non-null when it is — one CHECK covering both."
  constraint approval_requests_subject_shape_check check (
    (subject_type <> 'artifact' and subject_id is not null)
    or (subject_type = 'artifact' and artifact_url is not null)
  )
);

create index if not exists approval_requests_project_id_state_idx
  on approval_requests (project_id, state);

create index if not exists approval_requests_subject_type_subject_id_idx
  on approval_requests (subject_type, subject_id);

drop trigger if exists approval_requests_set_updated_at on approval_requests;
create trigger approval_requests_set_updated_at
  before update on approval_requests
  for each row
  execute function set_updated_at();

-- AS-024: a settled decision cannot be edited or deleted; a changed mind
-- requires a new approval request (via `supersedes_id`). Enforced by a
-- trigger, not only by RLS/policy, per the spec's explicit instruction —
-- even a caller with an UPDATE grant (the RPC itself included, on a
-- second/racing call) cannot mutate a row once OLD.state has left
-- 'pending'. The one legitimate transition (pending -> approved /
-- changes_requested / withdrawn) is unaffected because it fires on
-- OLD.state, not NEW.state.
create or replace function public.prevent_approval_request_settled_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if OLD.state <> 'pending' then
    raise exception 'approval_requests: a settled decision cannot be modified (id=%, state=%)', OLD.id, OLD.state
      using errcode = '42501';
  end if;
  return NEW;
end;
$$;

drop trigger if exists approval_requests_block_settled_update on approval_requests;
create trigger approval_requests_block_settled_update
  before update on approval_requests
  for each row
  execute function public.prevent_approval_request_settled_update();

-- ---------------------------------------------------------------------
-- 2. project_decision_owners
-- ---------------------------------------------------------------------

create table if not exists project_decision_owners (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  decision_type text not null,
  user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_decision_owners_decision_type_check check (
    decision_type in ('content', 'brand', 'technical', 'commercial')
  ),
  -- One owner per decision type per project. The Phase 0 deliverable
  -- this implements allows one person to own all four — the unique
  -- constraint is on the pair, not on the user.
  constraint project_decision_owners_project_decision_unique unique (project_id, decision_type)
);

drop trigger if exists project_decision_owners_set_updated_at on project_decision_owners;
create trigger project_decision_owners_set_updated_at
  before update on project_decision_owners
  for each row
  execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 3. RLS: approval_requests
-- ---------------------------------------------------------------------
-- Team: active workspace member, role not client, project visible — the
-- same `is_project_visible_to(project_id) and not is_project_client
-- (project_id)` shape 20260902020000 already established for every
-- other team-only SELECT (time_entries, task_activity, ...); writes use
-- `is_project_workspace_writer` alone, matching project_phases'
-- INSERT/UPDATE/DELETE policies (20260909010000).
--
-- Client SELECT: the tasks_select_client shape (membership + project
-- visibility + is_project_client) plus portal_enabled, plus — for
-- subject_type = 'task' only, per this feature's own clarified spec —
-- the subject task must itself be client_visible. An approval must
-- never become a side channel that reveals an internal task's title. A
-- doc/phase/artifact-subject approval has no such extra gate: raising
-- the approval IS the team's deliberate act of sharing it (unlike a
-- task, whose client_visible flag is a separate, independent fact).
--
-- Client UPDATE: none. Clients decide only through decide_approval_atomic.

alter table approval_requests enable row level security;

drop policy if exists approval_requests_select_team on approval_requests;
create policy approval_requests_select_team
  on approval_requests
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

drop policy if exists approval_requests_select_client on approval_requests;
create policy approval_requests_select_client
  on approval_requests
  for select
  to authenticated
  using (
    public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
    and (
      subject_type <> 'task'
      or exists (
        select 1
        from tasks t
        where t.id = approval_requests.subject_id
          and t.client_visible
          and t.deleted_at is null
      )
    )
  );

-- AS-020: creating an approval request against a task that is not
-- client-visible is rejected AT CREATION TIME with an explicit error —
-- enforced here, at the database layer, not only by F008's Server Action
-- validation, so a raw PostgREST insert bypassing the app entirely is
-- rejected the same way (an RLS violation is Postgres's own explicit
-- error, not a silent no-op). Only applies when subject_type = 'task';
-- doc/phase/artifact subjects have no such prerequisite (see the SELECT
-- policy's comment above for why task is the special case).
drop policy if exists approval_requests_insert_team on approval_requests;
create policy approval_requests_insert_team
  on approval_requests
  for insert
  to authenticated
  with check (
    public.is_project_workspace_writer(project_id)
    and requested_by = auth.uid()
    and (
      subject_type <> 'task'
      or exists (
        select 1
        from tasks t
        where t.id = approval_requests.subject_id
          and t.client_visible
          and t.deleted_at is null
      )
    )
  );

-- Team UPDATE is deliberately narrow: it lets a team member edit a
-- still-pending request's own metadata (title, description, due_at,
-- phase_id, ...) but the WITH CHECK below forces the row to stay
-- 'pending' with no decision fields set. Without this, any project
-- writer (not just the named decision owner) could set
-- state = 'approved' / decided_by = themselves directly through their
-- own RLS-scoped session, completely bypassing decide_approval_atomic's
-- AS-022 ownership check -- decide_approval_atomic itself is SECURITY
-- DEFINER and so is unaffected by this policy (it bypasses RLS as the
-- function owner, same as every other atomic RPC in this schema), but a
-- policy that also permitted the decision fields would silently open a
-- second, unguarded path to the exact outcome AS-022 says only the named
-- decision owner may reach.
drop policy if exists approval_requests_update_team on approval_requests;
create policy approval_requests_update_team
  on approval_requests
  for update
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (
    public.is_project_workspace_writer(project_id)
    and state = 'pending'
    and decided_by is null
    and decided_at is null
  );

-- No DELETE policy for any role (including team): a settled approval is
-- history, same "append-only, no UPDATE/DELETE policy at all" posture
-- audit_log (20260821211226) takes, and a pending one a team member
-- wants to retract should transition to 'withdrawn' (F010), not vanish.

-- ---------------------------------------------------------------------
-- 4. RLS: project_decision_owners
-- ---------------------------------------------------------------------
-- Team: same shape as approval_requests above. Client SELECT: F009's
-- "who approves what" grid needs to read this table directly — gated by
-- membership + project visibility + portal_enabled, same as every other
-- client-facing read in this migration. No client write of any kind.

alter table project_decision_owners enable row level security;

drop policy if exists project_decision_owners_select_team on project_decision_owners;
create policy project_decision_owners_select_team
  on project_decision_owners
  for select
  to authenticated
  using (
    public.is_project_visible_to(project_id)
    and not public.is_project_client(project_id)
  );

drop policy if exists project_decision_owners_select_client on project_decision_owners;
create policy project_decision_owners_select_client
  on project_decision_owners
  for select
  to authenticated
  using (
    public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and public.is_project_portal_enabled(project_id)
  );

drop policy if exists project_decision_owners_insert_team on project_decision_owners;
create policy project_decision_owners_insert_team
  on project_decision_owners
  for insert
  to authenticated
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_decision_owners_update_team on project_decision_owners;
create policy project_decision_owners_update_team
  on project_decision_owners
  for update
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

drop policy if exists project_decision_owners_delete_team on project_decision_owners;
create policy project_decision_owners_delete_team
  on project_decision_owners
  for delete
  to authenticated
  using (public.is_project_workspace_writer(project_id));

-- ---------------------------------------------------------------------
-- 5. notifications: widen the closed `kind` vocabulary
-- ---------------------------------------------------------------------
-- `notifications_kind_check` (20260823020000) is a closed list; a
-- decided approval is a new kind of notification this schema has never
-- produced before, so the CHECK must be widened before
-- `decide_approval_atomic` (below) can call `create_notification` with
-- it — an unmodified constraint would reject the insert with a CHECK
-- violation, not a business-logic error.

alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (
  kind in ('mention', 'comment_reply', 'task_assigned', 'task_due_soon', 'watcher_update', 'approval_decided')
);

-- ---------------------------------------------------------------------
-- 6. decide_approval_atomic(p_request_id, p_decision, p_note)
-- ---------------------------------------------------------------------
-- One transaction (Postgres wraps a whole function body in one implicit
-- transaction, same reasoning accept_client_request_atomic's own header
-- comment gives):
--   1. Load + lock the request; fail if not found or not 'pending'.
--   2. AS-022's actual enforcement point: verify the caller is the
--      project_decision_owners row for this request's decision_type.
--      The portal's disabled button is a courtesy, not a control — this
--      check runs whether the RPC is called through the app UI or a raw
--      PostgREST request.
--   3. Reject 'changes_requested' with an empty note.
--   4. Write state/decided_by/decided_at/decision_note (AS-023).
--   5. If subject_type = 'task', clear that task's
--      pending_client_approval (AS-023) — keeps the denormalised
--      boolean in sync, per the spec's explicit "do not delete the
--      boolean" instruction.
--   6. Write audit_log via the existing write_audit_log_entry() RPC
--      (20260821211226), not a direct insert — that table has no INSERT
--      policy for any role by design.
--   7. Create the team notification via the existing create_notification()
--      RPC (20260823030000, hardened 20260823110000/...100000), not a
--      direct insert — notifications has no client/authenticated INSERT
--      policy by design either.
create or replace function public.decide_approval_atomic(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns table (
  request_id uuid,
  state text,
  decided_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_decision_type text;
  v_subject_type text;
  v_subject_id uuid;
  v_state text;
  v_requested_by uuid;
  v_title text;
  v_owner_id uuid;
  v_decided_at timestamptz := now();
  v_task_project_id uuid;
  v_notify_task_id uuid;
begin
  if v_user_id is null then
    raise exception 'decide_approval_atomic: not authenticated' using errcode = '28000';
  end if;

  if p_decision not in ('approved', 'changes_requested') then
    raise exception 'decide_approval_atomic: invalid decision %', p_decision using errcode = '22023';
  end if;

  if p_decision = 'changes_requested' and (p_note is null or btrim(p_note) = '') then
    raise exception 'decide_approval_atomic: a note is required when requesting changes' using errcode = '22023';
  end if;

  select ar.project_id, ar.decision_type, ar.subject_type, ar.subject_id,
         ar.state, ar.requested_by, ar.title
    into v_project_id, v_decision_type, v_subject_type, v_subject_id,
         v_state, v_requested_by, v_title
    from approval_requests ar
   where ar.id = p_request_id
     for update of ar;

  if v_project_id is null then
    raise exception 'decide_approval_atomic: approval request not found' using errcode = 'P0002';
  end if;

  if v_state <> 'pending' then
    raise exception 'decide_approval_atomic: this request has already been decided' using errcode = '42501';
  end if;

  select p.workspace_id into v_workspace_id from projects p where p.id = v_project_id;
  if v_workspace_id is null then
    raise exception 'decide_approval_atomic: project not found' using errcode = 'P0002';
  end if;

  -- AS-022: the actual enforcement point, independent of any UI state.
  select pdo.user_id into v_owner_id
    from project_decision_owners pdo
   where pdo.project_id = v_project_id
     and pdo.decision_type = v_decision_type;

  if v_owner_id is null or v_owner_id <> v_user_id then
    raise exception 'decide_approval_atomic: you are not the decision owner for this request' using errcode = '42501';
  end if;

  update approval_requests
     set state = p_decision,
         decided_by = v_user_id,
         decided_at = v_decided_at,
         decision_note = p_note
   where id = p_request_id;

  v_notify_task_id := null;
  if v_subject_type = 'task' and v_subject_id is not null then
    update tasks
       set pending_client_approval = false
     where id = v_subject_id;

    -- Defensive: only pass the task id to create_notification when it
    -- genuinely belongs to this approval's own project (create_notification's
    -- own F320 hardening rejects a task_id/workspace_id mismatch outright,
    -- which would abort this entire decision rather than degrade
    -- gracefully). subject_id carries no FK (see table comment above), so
    -- this is the one place that fact could otherwise surface as a hard
    -- failure of an otherwise-valid decision.
    select t.project_id into v_task_project_id from tasks t where t.id = v_subject_id;
    if v_task_project_id = v_project_id then
      v_notify_task_id := v_subject_id;
    end if;
  end if;

  perform public.write_audit_log_entry(
    v_workspace_id,
    case when p_decision = 'approved' then 'approval_request.approved' else 'approval_request.changes_requested' end,
    'approval_request',
    p_request_id,
    jsonb_build_object(
      'decision_type', v_decision_type,
      'subject_type', v_subject_type,
      'subject_id', v_subject_id,
      'note', p_note
    )
  );

  perform public.create_notification(
    p_user_id => v_requested_by,
    p_workspace_id => v_workspace_id,
    p_kind => 'approval_decided',
    p_actor_id => v_user_id,
    p_task_id => v_notify_task_id,
    p_comment_id => null,
    p_payload => jsonb_build_object(
      'request_id', p_request_id,
      'title', v_title,
      'decision', p_decision,
      'decision_type', v_decision_type
    )
  );

  return query select p_request_id, p_decision, v_decided_at;
end;
$$;

revoke all on function public.decide_approval_atomic(uuid, text, text) from public;
grant execute on function public.decide_approval_atomic(uuid, text, text) to authenticated;
