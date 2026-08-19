-- F148: parent/child task relation (AS-265, AS-266)
--
-- Depends on: F132 in the feature spec, but F132 (project-visibility RLS
-- helper `is_project_visible_to()`) has NOT been built yet — M11 lands
-- later than M13 in this mission's plan. This migration therefore does
-- NOT call or invent `is_project_visible_to()`. It adds no new RLS policy:
-- `tasks.parent_task_id` is a plain column on `tasks`, already covered
-- end-to-end by the existing mission-1 policies
--   tasks_select_active_members / tasks_insert_active_members /
--   tasks_update_active_members
--     (supabase/migrations/20260818013805_rls_tasks.sql)
-- which already scope through workspace_members via
-- is_project_workspace_member(project_id). Adding a new column to an
-- already-RLS-covered table needs no new policy, exactly the precedent
-- set by F145 (supabase/migrations/20260819061129_project_keys_and_task_numbers.sql).
-- When F132 lands, its sweep should double check the checklist at the
-- bottom of this file rather than assume this migration is a gap.
--
-- Scope note (Clarified implementation "Touches" answer / feature spec
-- "Files (approximate)"): this feature's file list is
-- `supabase/migrations/` + `lib/supabase/database.types.ts` only — no
-- Server Action / Zod schema changes in this feature. The DB is the
-- enforcement layer here; a later feature that adds a subtask Server
-- Action is responsible for mirroring these rules in a Zod schema per
-- the Clarified implementation's validation answer ("in the database ...
-- AND mirrored in a Zod schema for the action layer").
--
-- A child task is still a normal task: it goes through the SAME
-- tasks_assign_number BEFORE INSERT trigger (F145,
-- 20260819061129_project_keys_and_task_numbers.sql) as every other task
-- and gets its own project-scoped number/key exactly like a top-level
-- task. Nothing here special-cases that trigger, and nothing needs to —
-- proven in tests/integration/db-subtasks.test.ts.

-- ---------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------

alter table tasks
  add column if not exists parent_task_id uuid references tasks (id);

-- Index strategy: index the new FK column per the migration-type
-- clarification's Index strategy answer (same convention as
-- tasks.project_id / tasks.assignee_id). This is also the column the
-- "does this task already have children" check in the trigger below
-- filters on, so it doubles as that check's lookup index.
create index if not exists tasks_parent_task_id_idx on tasks (parent_task_id);

-- ---------------------------------------------------------------------
-- AS-265 (part 1): a task cannot be its own parent — CHECK constraint,
-- cheapest and most direct enforcement, independent of any trigger.
-- ---------------------------------------------------------------------

alter table tasks
  add constraint tasks_parent_not_self check (
    parent_task_id is null or parent_task_id <> id
  );

-- ---------------------------------------------------------------------
-- AS-265 (part 2, cycles) + AS-266 (one-level nesting limit)
-- ---------------------------------------------------------------------
--
-- A plain CHECK constraint can only see the row being written, so it
-- cannot express "is my parent itself a child" or "do I already have
-- children" — both require reading OTHER rows of the same table. That
-- needs a trigger.
--
-- *** DELIBERATE PRODUCT LIMIT — DO NOT "FIX" ***
-- Nesting is limited to exactly one level: a top-level task may have
-- children, but a child may never itself have children. This is a
-- deliberate product rule (F148 spec), not an oversight or a missing
-- recursive-CTE depth check. Do not generalize this into arbitrary-depth
-- trees.
--
-- This single rule — "a task that already has a parent cannot be used as
-- a parent, and a task that already has children cannot be given a
-- parent" — is also what makes multi-node cycles impossible, not just
-- self-reference. A cycle needs at least two edges (e.g. A.parent = B and
-- B.parent = A). Creating the second edge requires B to accept a parent
-- while B is already somebody's parent (of A), which the "already has
-- children" branch below rejects. So AS-265's cycle-rejection and
-- AS-266's one-level limit are enforced by the same two checks, not two
-- separate mechanisms.
create or replace function public.enforce_task_parent_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_project_id uuid;
  v_parent_parent_id uuid;
begin
  if new.parent_task_id is not null then
    -- Redundant with tasks_parent_not_self, kept here so this trigger's
    -- error message is specific even if called in a context where the
    -- CHECK hasn't fired yet.
    if new.parent_task_id = new.id then
      raise exception 'a task cannot be its own parent';
    end if;

    select project_id, parent_task_id
      into v_parent_project_id, v_parent_parent_id
      from tasks
      where id = new.parent_task_id;

    if v_parent_project_id is null then
      raise exception 'parent task % does not exist', new.parent_task_id;
    end if;

    -- AS-266 + AS-265 (cycle rejection): the proposed parent must itself
    -- be a top-level task (no parent of its own). Nesting deeper than one
    -- level, and every multi-node cycle, is rejected here.
    if v_parent_parent_id is not null then
      raise exception
        'nesting is limited to one level: task % already has a parent and cannot be used as a parent itself',
        new.parent_task_id;
    end if;

    -- Parent and child must belong to the same project (feature spec,
    -- enforced in the database, not only in the Server Action layer).
    if v_parent_project_id <> new.project_id then
      raise exception 'parent and child tasks must belong to the same project';
    end if;

    -- AS-266, the other direction: this task cannot already be a parent
    -- of other (live) tasks if it is now being given a parent itself —
    -- that would produce a 3-level chain (grandparent -> this -> its
    -- existing children).
    if exists (
      select 1 from tasks
      where parent_task_id = new.id
        and deleted_at is null
    ) then
      raise exception
        'task % already has children and cannot be assigned a parent (nesting is limited to one level)',
        new.id;
    end if;
  end if;

  -- Same-project rule, other direction: a task that is currently used as
  -- a parent cannot be moved to a different project out from under its
  -- children (would silently break the "parent and child share a
  -- project" invariant for the existing children without touching their
  -- own rows).
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    if exists (
      select 1 from tasks
      where parent_task_id = new.id
        and deleted_at is null
    ) then
      raise exception
        'task % has children and cannot be moved to a different project',
        new.id;
    end if;
  end if;

  return new;
end;
$$;

-- SECURITY DEFINER so the parent/children lookups above are not
-- themselves gated by the inserting/updating role's own RLS SELECT
-- policy on tasks (mirrors assign_task_number()/assign_project_key() in
-- 20260819061129_project_keys_and_task_numbers.sql) — it only fires for
-- rows the tasks_insert_active_members/tasks_update_active_members RLS
-- policies already allowed to be written, so this does not widen who can
-- write a task, only guarantees the parent/child invariants hold.
drop trigger if exists tasks_enforce_parent_rules on tasks;
create trigger tasks_enforce_parent_rules
  before insert or update of parent_task_id, project_id on tasks
  for each row
  execute function public.enforce_task_parent_rules();

-- ---------------------------------------------------------------------
-- F132 sweep checklist (explicit, per this feature's dependency
-- correction — F132's "project-visible-to" RLS pass should treat this as
-- a checklist, not rely on memory of what F148 touched):
--   - No new RLS policy was added by this migration. `tasks.parent_task_id`
--     is covered by the EXISTING policies:
--       tasks_select_active_members, tasks_insert_active_members,
--       tasks_update_active_members (20260818013805_rls_tasks.sql)
--   - No new CHECK/trigger here references project visibility —
--     tasks_parent_not_self and enforce_task_parent_rules() both encode
--     structural invariants (self-reference, nesting depth, same-project)
--     independent of who can see a row.
--   - One new SECURITY DEFINER function was added:
--       public.enforce_task_parent_rules()
--     (trigger only, not callable directly by client roles beyond its
--     trigger use).
--   - Nothing in this migration calls or assumes the existence of
--     `is_project_visible_to()`.
