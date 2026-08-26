-- C5 (docs/client-portal-plan.md): client_requests — the one thing a client
-- may write.
--
-- A separate table rather than letting a client insert into `tasks`
-- directly. Three reasons, in order of weight:
--
--   1. A request is not a task. It has no status column, no assignee, no
--      position on a board; it has a decision attached to it (accepted,
--      declined, and why). Modelling it as a task would mean every board
--      query in the app growing an "except the ones a client filed that
--      nobody has triaged yet" clause.
--   2. The team's board stays the team's. An external party cannot put a
--      row on it, only ask for one.
--   3. `tasks` write policies stay closed to clients, so there is no
--      "clients may insert, but only when..." branch to get wrong later.
--
-- The link back is `converted_task_id`: when the team accepts a request
-- they create a real task from it, and the client then follows that task's
-- progress through the portal like any other shared work.

create table if not exists public.client_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  title text not null,
  body text,
  desired_by date,
  status text not null default 'submitted'
    check (status in ('submitted', 'in_review', 'accepted', 'declined')),
  -- Set when the team declines, so the portal can show the client WHY
  -- rather than a bare "declined" that invites an email asking the same
  -- question.
  decline_reason text,
  converted_task_id uuid references tasks (id) on delete set null,
  -- Who triaged it, for the team's own accountability. Nullable: an
  -- untouched request has nobody attached to it yet.
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Same non-empty-after-trim rule every user-authored text column in this
  -- schema carries (F100's lesson: `not null` does not reject '').
  constraint client_requests_title_not_empty check (btrim(title) <> ''),

  -- A declined request must say why, and a request that is not declined
  -- must not carry a stale reason from an earlier decision.
  constraint client_requests_decline_reason_matches_status check (
    (status = 'declined' and btrim(coalesce(decline_reason, '')) <> '')
    or (status <> 'declined' and decline_reason is null)
  ),

  -- Only an accepted request can point at a task. This is what stops the
  -- portal ever showing a client "declined" next to a live task link.
  constraint client_requests_converted_only_when_accepted check (
    converted_task_id is null or status = 'accepted'
  )
);

create index if not exists client_requests_project_id_idx
  on public.client_requests (project_id);
create index if not exists client_requests_created_by_idx
  on public.client_requests (created_by);
-- The team inbox reads "everything not yet triaged, newest first".
create index if not exists client_requests_status_created_at_idx
  on public.client_requests (status, created_at desc);

drop trigger if exists client_requests_set_updated_at on public.client_requests;
create trigger client_requests_set_updated_at
  before update on public.client_requests
  for each row
  execute function set_updated_at();

alter table public.client_requests enable row level security;

-- ---------------------------------------------------------------------
-- SELECT
-- ---------------------------------------------------------------------
-- The author sees their own requests; the team sees every request on a
-- project they can see. Deliberately NOT "any client on the project sees
-- all of its requests" — two clients from different companies can share a
-- project, and one should not read the other's asks.

drop policy if exists client_requests_select_author_or_team on public.client_requests;
create policy client_requests_select_author_or_team
  on public.client_requests
  for select
  to authenticated
  using (
    created_by = auth.uid()
    or (
      public.is_project_visible_to(project_id)
      and not public.is_project_client(project_id)
    )
  );

-- ---------------------------------------------------------------------
-- INSERT
-- ---------------------------------------------------------------------
-- Only a client, only on a project they belong to, only attributed to
-- themselves, and only in the 'submitted' state — a client cannot file a
-- request that arrives pre-accepted, nor one already pointing at a task.
--
-- `is_project_visible_to` is what enforces "a project they belong to": for
-- a client that predicate is already narrowed to their explicit
-- project_members rows (20260902010000).

drop policy if exists client_requests_insert_own on public.client_requests;
create policy client_requests_insert_own
  on public.client_requests
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_project_client(project_id)
    and public.is_project_visible_to(project_id)
    and status = 'submitted'
    and converted_task_id is null
    and reviewed_by is null
  );

-- ---------------------------------------------------------------------
-- UPDATE
-- ---------------------------------------------------------------------
-- Split in two, because the two audiences may change different things.
--
-- The client may correct their own request while it is still untouched.
-- The WITH CHECK pins status to 'submitted' on both sides, so an author
-- cannot accept their own request by writing the column directly — the
-- USING clause alone would not prevent that.

drop policy if exists client_requests_update_author_while_submitted on public.client_requests;
create policy client_requests_update_author_while_submitted
  on public.client_requests
  for update
  to authenticated
  using (created_by = auth.uid() and status = 'submitted')
  with check (
    created_by = auth.uid()
    and status = 'submitted'
    and converted_task_id is null
    and reviewed_by is null
  );

-- The team triages. `is_project_workspace_writer` already excludes viewer
-- and client, so this is the team-writers-only half.
drop policy if exists client_requests_update_team on public.client_requests;
create policy client_requests_update_team
  on public.client_requests
  for update
  to authenticated
  using (public.is_project_workspace_writer(project_id))
  with check (public.is_project_workspace_writer(project_id));

-- ---------------------------------------------------------------------
-- DELETE
-- ---------------------------------------------------------------------
-- The author may withdraw a request nobody has acted on. The team never
-- deletes: a declined request with its reason is the record of a decision,
-- and deleting it would erase the answer the client was given.

drop policy if exists client_requests_delete_author_while_submitted on public.client_requests;
create policy client_requests_delete_author_while_submitted
  on public.client_requests
  for delete
  to authenticated
  using (created_by = auth.uid() and status = 'submitted');
