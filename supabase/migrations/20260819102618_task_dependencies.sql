-- F155: task_dependencies table + RLS (AS-276, AS-279, AS-284, AS-285)
--
-- Depends on: F132 in the feature spec, but F132 (project-visibility RLS
-- helper `is_project_visible_to()`) has NOT been built yet — M11 lands
-- later than M13 in this mission's plan. This migration therefore does
-- NOT call or invent `is_project_visible_to()`. RLS is scoped through the
-- EXISTING mission-1 tasks -> projects -> workspace_members pattern,
-- reusing `public.is_task_workspace_member(target_task_id)` (F058,
-- 20260818040214_create_comments.sql) exactly as F151/F152 did for
-- checklist_items — this table has the identical "join through a task to
-- reach a workspace" shape.
--
-- Columns are exactly the set named in the feature spec's Draft scope:
-- id, blocking_task_id, blocked_task_id, created_by, created_at. Cycle
-- prevention (F156, AS-278) is explicitly OUT of scope here — nothing in
-- this migration attempts to detect or reject a cycle beyond the direct
-- self-reference case (AS-279), and no comment below should be read as
-- implying cycle detection exists yet.
--
-- Relation type: only one relation ("blocks" / "blocked by") is modeled,
-- per the Clarified implementation's ambiguity-resolution answer ("relates
-- to" / "duplicates" are explicitly out of scope, ★ default from the
-- clarification file).
--
-- Verb decision for this migration (per the worker brief's explicit
-- instruction to learn from F151's SELECT/INSERT-only gap that F152 later
-- had to close): a dependency row is created and removed but NEVER
-- edited — there is no "change which two tasks this row links" operation
-- in the product (repointing a dependency is modeled as delete + insert,
-- same as how a relation table normally works). So this migration ships
-- SELECT, INSERT, and DELETE together, and deliberately OMITS UPDATE:
--   - SELECT: a member needs to read a task's dependencies (AS-276,
--     AS-277's future read path).
--   - INSERT: a member needs to create a dependency (AS-276, AS-279,
--     AS-285).
--   - DELETE: AS-282 ("a dependency can be removed by either side of the
--     relationship") is a real, named assertion in this table's own
--     section of the validation contract, so — unlike F151's checklist
--     precedent, where UPDATE/DELETE genuinely belonged to a separate,
--     not-yet-built feature (F152) — leaving DELETE out here would
--     silently deny a behaviour this table is already known to need,
--     with no dedicated follow-up feature spec to catch the gap. Shipping
--     it now costs nothing extra (identical shape to SELECT) and avoids
--     recreating the exact class of gap this brief calls out.
--   - UPDATE: intentionally absent. There is no legitimate "edit" of a
--     dependency row — every field (blocking_task_id, blocked_task_id,
--     created_by) is immutable once created. Absence of an UPDATE policy
--     denies it by default under RLS, which is the correct, safe
--     behaviour, not a gap.

create table if not exists task_dependencies (
  id uuid primary key default gen_random_uuid(),
  blocking_task_id uuid not null references tasks (id) on delete cascade,
  blocked_task_id uuid not null references tasks (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  -- AS-279: a task cannot depend on itself.
  constraint task_dependencies_not_self check (
    blocking_task_id <> blocked_task_id
  ),
  -- The same blocking/blocked pair cannot be recorded twice.
  constraint task_dependencies_unique_pair unique (
    blocking_task_id, blocked_task_id
  )
);

-- Index strategy: index every FK per the migration-type clarification's
-- Index strategy answer, plus the columns the two known read directions
-- (AS-277, out of scope here but a certain near-term follow-up) filter
-- on: "what does this task block" and "what blocks this task".
--   - `task_dependencies_unique_pair`'s own unique index is a composite
--     btree on (blocking_task_id, blocked_task_id) — that already serves
--     an equality filter on blocking_task_id alone (its leftmost column),
--     so a separate single-column blocking_task_id index would be
--     redundant.
--   - blocked_task_id is NOT the leftmost column of that composite index,
--     so it gets its own explicit index below to serve the reverse
--     direction ("which tasks block this one") without a sequential scan.
-- created_by is not indexed: no query in this feature or its known
-- follow-ups (AS-277, AS-282) filters or sorts on it, same reasoning
-- checklist_items applied to checked_by.
create index if not exists task_dependencies_blocked_task_id_idx
  on task_dependencies (blocked_task_id);

-- ---------------------------------------------------------------------
-- AS-285: a dependency across two different workspaces must be rejected
-- AT THE DATABASE, not only in the action layer.
-- ---------------------------------------------------------------------
--
-- A plain CHECK constraint can only see the row being written, so it
-- cannot express "do these two FKs resolve to the same workspace" —
-- that requires reading OTHER tables (tasks, projects), which needs a
-- trigger, not a CHECK. This mirrors F148's
-- `enforce_task_parent_rules()` precedent
-- (20260819071050_subtasks_parent_task_id.sql) for the same reason.
--
-- Deliberately a BEFORE INSERT trigger only (no UPDATE) — this table has
-- no UPDATE policy (see the verb decision above), so there is no write
-- path that could change blocking_task_id/blocked_task_id after creation
-- to smuggle a cross-workspace pairing past this check.
--
-- SECURITY DEFINER so the tasks/projects lookups below are not
-- themselves gated by the inserting role's own RLS SELECT policy on
-- tasks — it only fires for rows the task_dependencies INSERT policy
-- already allowed to be attempted, so this does not widen who can write
-- a dependency, it only guarantees the same-workspace invariant holds
-- for whatever gets through. This is also why the trigger is the REAL
-- enforcement for AS-285, not the RLS policy alone: a caller who happens
-- to be an active member of BOTH workspaces would satisfy an RLS check
-- built only from `is_task_workspace_member`, since that predicate only
-- proves membership in each task's own workspace individually, not that
-- the two tasks share ONE workspace. Only a direct workspace-to-workspace
-- equality check (below) closes that gap, and it applies even to writes
-- issued through the service-role client (RLS is bypassed by service
-- role; a trigger is not).
create or replace function public.enforce_task_dependency_same_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blocking_workspace_id uuid;
  v_blocked_workspace_id uuid;
begin
  select p.workspace_id
    into v_blocking_workspace_id
    from tasks t
    join projects p on p.id = t.project_id
    where t.id = new.blocking_task_id;

  if v_blocking_workspace_id is null then
    raise exception 'blocking task % does not exist', new.blocking_task_id;
  end if;

  select p.workspace_id
    into v_blocked_workspace_id
    from tasks t
    join projects p on p.id = t.project_id
    where t.id = new.blocked_task_id;

  if v_blocked_workspace_id is null then
    raise exception 'blocked task % does not exist', new.blocked_task_id;
  end if;

  if v_blocking_workspace_id <> v_blocked_workspace_id then
    raise exception
      'a task dependency cannot cross workspaces (blocking task workspace %, blocked task workspace %)',
      v_blocking_workspace_id, v_blocked_workspace_id;
  end if;

  return new;
end;
$$;

drop trigger if exists task_dependencies_enforce_same_workspace on task_dependencies;
create trigger task_dependencies_enforce_same_workspace
  before insert on task_dependencies
  for each row
  execute function public.enforce_task_dependency_same_workspace();

alter table task_dependencies enable row level security;

-- No FORCE ROW LEVEL SECURITY: same rationale as F012/F025/F034/F058/F151
-- — the app never connects as the table owner for reads; privileged
-- server-side access goes through the secret key, which bypasses RLS by
-- design and is never exposed to the client.

-- SELECT: any active member of the workspace that (transitively) owns the
-- dependency's blocking task (AS-276). Checking blocking_task_id alone is
-- sufficient for any row that made it past the trigger above, since every
-- persisted row is guaranteed to have both tasks in the same workspace —
-- this mirrors checklist_items_select_active_members's single-column
-- check via the same shared helper.
create policy task_dependencies_select_active_members
  on task_dependencies
  for select
  to authenticated
  using (
    public.is_task_workspace_member(blocking_task_id)
  );

-- INSERT: an active member of BOTH the blocking task's workspace AND the
-- blocked task's workspace may create the dependency. Checking both
-- columns here (rather than just one, as SELECT/DELETE do) is deliberate
-- defense in depth distinct from the trigger above: it means a caller who
-- is not even a member of one side's workspace is rejected by RLS before
-- the trigger runs at all. It is NOT sufficient on its own for AS-285
-- (a caller who is a member of two different workspaces would satisfy
-- this check for a genuinely cross-workspace pair), which is exactly why
-- `task_dependencies_enforce_same_workspace` also exists — the two
-- mechanisms are complementary, not redundant.
create policy task_dependencies_insert_active_members
  on task_dependencies
  for insert
  to authenticated
  with check (
    public.is_task_workspace_member(blocking_task_id)
    and public.is_task_workspace_member(blocked_task_id)
  );

-- DELETE: AS-282 ("a dependency can be removed by either side of the
-- relationship") — any active member of the blocking task's workspace may
-- remove the row. Only one column needs checking for the same reason
-- SELECT only checks one: every persisted row already has both tasks in
-- one workspace, so "either side" in the product sense (the UI on either
-- task's detail view can trigger the removal) is fully covered by a
-- single membership check on the shared workspace.
create policy task_dependencies_delete_active_members
  on task_dependencies
  for delete
  to authenticated
  using (
    public.is_task_workspace_member(blocking_task_id)
  );

-- No UPDATE policy: see the verb decision note at the top of this file —
-- dependencies are immutable once created (create + delete only), so
-- absence of an UPDATE policy is the intended, correct behaviour, not an
-- oversight.
--
-- No policy is created for anon or for authenticated non-members: absence
-- of a matching policy means those rows are simply not
-- returned/writable/deletable (RLS default deny), same "filtered, not
-- errored" behavior established by every prior table in this mission.

-- ---------------------------------------------------------------------
-- F132 sweep checklist (explicit, per this feature's dependency
-- correction — F132's "project-visible-to" RLS pass should treat this as
-- a checklist, not rely on memory of what F155 touched):
--   - Table created: task_dependencies.
--   - Policies added (3): task_dependencies_select_active_members,
--     task_dependencies_insert_active_members,
--     task_dependencies_delete_active_members — all three scoped through
--     the EXISTING public.is_task_workspace_member(task_id) helper (no
--     new RLS-predicate function was created by this migration; the one
--     new function, enforce_task_dependency_same_workspace(), is a
--     trigger, not an RLS predicate — see below).
--   - No UPDATE policy exists on task_dependencies, and none is expected
--     — dependencies are immutable (create/delete only), documented
--     above, not a gap to sweep.
--   - Constraints added (2): task_dependencies_not_self (CHECK,
--     structural, independent of row visibility — no F132 revisit
--     needed), task_dependencies_unique_pair (UNIQUE, structural, same).
--   - Indexes added: the unique constraint's composite index on
--     (blocking_task_id, blocked_task_id), plus
--     task_dependencies_blocked_task_id_idx on (blocked_task_id).
--   - Triggers added (1): task_dependencies_enforce_same_workspace,
--     BEFORE INSERT, executing
--     public.enforce_task_dependency_same_workspace() — a structural,
--     cross-workspace-integrity guard independent of row visibility
--     (AS-285). This is the one function this migration adds beyond the
--     reused is_task_workspace_member helper.
--   - Nothing in this migration calls or assumes the existence of
--     `is_project_visible_to()`.
--   - Cycle prevention (AS-278) is explicitly NOT implemented here — that
--     is F156's scope, not swept by this checklist.
-- ---------------------------------------------------------------------
