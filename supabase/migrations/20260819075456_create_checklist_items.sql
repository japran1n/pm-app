-- F151: checklist_items table + RLS (AS-269, AS-274)
--
-- Depends on: F132 in the feature spec, but F132 (project-visibility RLS
-- helper `is_project_visible_to()`) has NOT been built yet — M11 lands
-- later than M13 in this mission's plan. This migration therefore does
-- NOT call or invent `is_project_visible_to()`. RLS is scoped through the
-- EXISTING mission-1 tasks -> projects -> workspace_members pattern,
-- mirroring supabase/migrations/20260818040214_create_comments.sql (F058)
-- exactly, since checklist_items -> task_id has the identical join shape
-- as comments -> task_id.
--
-- Columns are exactly the set named in the feature spec's Draft scope
-- (Clarified implementation, Data shape answer): id, task_id FK, content
-- text (not blank), is_checked boolean default false, position double
-- precision, checked_by, checked_at, created_at. No deleted_at — the spec
-- does not list one, unlike comments/tasks; hard delete for checklist
-- items is left to the feature that implements AS-271 (rename/reorder/
-- delete), which is out of scope here.
--
-- Learned from F100 (projects_name_not_empty gap): a `not null` column
-- does NOT reject an empty string. `content` gets an explicit
-- non-empty-after-trim CHECK from the start, per tasks/comments
-- precedent.

create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id),
  content text not null,
  is_checked boolean not null default false,
  -- Fractional-index position (lib/board/position.ts's calculatePosition),
  -- NOT an integer order column, per the Clarified implementation's
  -- ambiguity-resolution answer ("reuse the fractional-index position
  -- convention from the board rather than an integer order column").
  -- Same shape/default as tasks.position
  -- (20260818013434_create_tasks.sql): a plain float8 column, ordering
  -- maths lives entirely in application code. Note for whoever builds the
  -- checklist reorder feature (AS-271): lib/board/position.ts's
  -- calculatePosition already has a bound-safety fix (F101) for the
  -- floating-point-precision edge case where repeated inserts between the
  -- same two neighbors collapse the midpoint onto one of them — reuse
  -- that function, do not reimplement the maths.
  position double precision not null default 0,
  checked_by uuid references auth.users (id),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint checklist_items_content_not_empty check (btrim(content) <> '')
);

-- Index strategy: a single composite index on (task_id, position) per the
-- migration-type clarification's Index strategy answer. This covers both
-- of this feature's known query shapes — the RLS policies' `task_id`
-- lookup (composite index still satisfies an equality filter on its
-- leftmost column, so a separate single-column task_id index would be
-- redundant) and the anticipated main read path, "all checklist items for
-- a task, ordered by position" (AS-269), which a future checklist-listing
-- feature will run. checked_by is not indexed: no query in this feature
-- or its known follow-ups (AS-270/AS-271) filters or sorts on it.
create index if not exists checklist_items_task_id_position_idx
  on checklist_items (task_id, position);

alter table checklist_items enable row level security;

-- No FORCE ROW LEVEL SECURITY: same rationale as F012/F025/F034/F058 —
-- the app never connects as the table owner for reads; privileged
-- server-side access goes through the secret key, which bypasses RLS by
-- design and is never exposed to the client.

-- SELECT: any active member of the workspace that (transitively) owns the
-- checklist item's task (AS-274). Reuses
-- `public.is_task_workspace_member(target_task_id)`, the SECURITY
-- DEFINER helper F058 already created for comments
-- (20260818040214_create_comments.sql) — checklist_items.task_id joins to
-- workspace_members through the exact same tasks -> projects ->
-- workspace_members chain, so this is the "shared SQL helper rather than
-- a copy-pasted predicate" the Clarified implementation's Access control
-- answer calls for, not a new duplicate function.
create policy checklist_items_select_active_members
  on checklist_items
  for select
  to authenticated
  using (
    public.is_task_workspace_member(task_id)
  );

-- INSERT: any active member of the target task's workspace may add a
-- checklist item. with check re-validates task_id on the incoming row so
-- a member of workspace A cannot insert a checklist item claiming a
-- task_id that belongs to workspace B (AS-274, cross-workspace write
-- rejection).
create policy checklist_items_insert_active_members
  on checklist_items
  for insert
  to authenticated
  with check (
    public.is_task_workspace_member(task_id)
  );

-- No UPDATE policy in this migration: checking/unchecking, renaming, and
-- reordering a checklist item (AS-270, AS-271) are out of scope for this
-- feature (F151's assigned assertions are AS-269 and AS-274 only, per the
-- Rules' "implement only what your feature spec covers"). Mirrors F058's
-- create_comments.sql precedent, which deliberately shipped SELECT +
-- INSERT only and left UPDATE to a dedicated follow-up feature (F061).
-- The feature that implements AS-270/AS-271 should add a narrowly-scoped
-- UPDATE policy here (any active member, matching tasks_update_active_
-- members' shape — checklist items are task-owned state, not
-- user-authored content like comments, so there is no author-or-admin
-- restriction expected).
--
-- No DELETE policy in this migration for the same reason — AS-271's
-- "deleted" behaviour is out of scope here. Absence of a DELETE policy
-- denies hard DELETE by default under RLS until that feature adds one.
--
-- No policy is created for anon or for authenticated non-members: absence
-- of a matching policy means those rows are simply not returned/writable
-- (RLS default deny), which is what AS-274 requires (filtered, not
-- errored).

-- ---------------------------------------------------------------------
-- F132 sweep checklist (explicit, per this feature's dependency
-- correction — F132's "project-visible-to" RLS pass should treat this as
-- a checklist, not rely on memory of what F151 touched):
--   - Table created: checklist_items
--   - Policies added (2): checklist_items_select_active_members,
--     checklist_items_insert_active_members — both scoped through the
--     EXISTING public.is_task_workspace_member(task_id) helper (no new
--     RLS function was created by this migration).
--   - No UPDATE or DELETE policy exists yet on checklist_items as of this
--     migration; whichever future feature adds them must also be swept.
--   - Constraints added (1): checklist_items_content_not_empty (CHECK,
--     structural — independent of row visibility, does not need a F132
--     revisit).
--   - Indexes added (1): checklist_items_task_id_position_idx on
--     (task_id, position).
--   - Triggers added: none.
--   - Nothing in this migration calls or assumes the existence of
--     `is_project_visible_to()`.
-- ---------------------------------------------------------------------
