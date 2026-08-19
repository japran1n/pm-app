-- F149: subtask create, promote, cascade delete (AS-267, AS-268)
--
-- Depends on: F148 (supabase/migrations/20260819071050_subtasks_parent_task_id.sql),
-- which added `tasks.parent_task_id` plus its one-level-nesting/no-cycle/
-- same-project invariants. This migration adds:
--   1. `tasks.deleted_via_task_id` — cascade PROVENANCE. Nullable FK back
--      to `tasks.id`, set only when a child's soft-delete happened as a
--      SIDE EFFECT of its parent being deleted (never set for a task that
--      was deleted directly, whether it's a top-level task, a child, or a
--      former-parent). This is what lets the future F189 restore feature
--      (out of scope here) reverse a cascade exactly: restoring a parent
--      should also restore children whose `deleted_via_task_id` equals
--      that parent's id, but must NOT resurrect a child that already had
--      `deleted_at` set independently before the parent was deleted (that
--      child's `deleted_via_task_id` stays null, since the cascade below
--      only ever touches currently-live rows).
--   2. `cascade_delete_task(p_task_id)` — a single SECURITY DEFINER
--      PL/pgSQL RPC that soft-deletes the given task AND, in the exact
--      same function invocation (one implicit Postgres transaction), soft-
--      deletes all of its currently-live direct children, stamping their
--      `deleted_via_task_id`. Per this feature's Clarified implementation
--      ("one statement or one RPC for the whole mutation where atomicity
--      matters") and the worker brief's explicit "must be one transaction
--      — a partial cascade ... leaves orphans visible on the board": two
--      independent `.update()` calls from lib/actions/tasks.ts would be
--      two separate network round trips/transactions, so a crash or
--      connection drop between them could soft-delete the parent while
--      leaving live (visible) children behind. A single PL/pgSQL function
--      body is atomic by construction — either every UPDATE in it commits,
--      or none do — the same pattern already used by
--      create_workspace_with_owner / start_timer_atomic / stop_timer_atomic.
--
-- Nesting is capped at one level (F148, deliberate product rule), so a
-- "cascade to children" only ever needs to touch direct children —
-- there is no grandchild level to recurse into.
--
-- Promote (AS-268) needs no new migration: it is a plain
-- `update tasks set parent_task_id = null where id = ...`, already fully
-- covered by the existing tasks_update_active_members RLS policy and by
-- enforce_task_parent_rules() (F148) — setting parent_task_id to null
-- trivially satisfies every one of that trigger's parent-related checks
-- (they all short-circuit on `new.parent_task_id is not null`). A
-- promoted task's `position` is untouched: it was already assigned a
-- normal fractional-index position in its (project, status) column at
-- creation time (createTask's existing calculatePosition call, unchanged
-- by this feature), the same axis every top-level task shares — so a
-- promoted child is already a valid, correctly-ordered board card the
-- instant its parent_task_id clears, with nothing left to recompute.
--
-- No new RLS policy needed for either the new column or the new RPC:
--   - `deleted_via_task_id` is a plain column on the already-RLS-covered
--     `tasks` table (tasks_select_active_members / etc.,
--     20260818013805_rls_tasks.sql) — same precedent as F145/F148 adding
--     columns to `tasks` with no new policy.
--   - `cascade_delete_task` is SECURITY DEFINER and granted ONLY to
--     `service_role` (see grant below), not `authenticated`/`anon` — it
--     performs no membership check of its own, because it is invoked
--     exclusively from lib/actions/tasks.ts's `deleteTask`, which has
--     already independently re-verified the caller's workspace membership
--     (defense in depth, AS-143) via the admin (service_role) client
--     before calling this RPC. Restricting the grant to service_role means
--     a caller cannot reach this cascade directly with a client key and
--     skip that membership check.
--
-- F132 sweep note (project-visibility RLS, not yet built — see F148's
-- handoff for the same caveat): nothing here calls or assumes
-- `is_project_visible_to()`. No new RLS policy was added.

-- ---------------------------------------------------------------------
-- Column: cascade provenance
-- ---------------------------------------------------------------------

alter table tasks
  add column if not exists deleted_via_task_id uuid references tasks (id);

-- Indexed for two lookup shapes: (a) this migration's own cascade UPDATE
-- filters on `parent_task_id`, already indexed by F148
-- (tasks_parent_task_id_idx); (b) the future F189 restore feature will
-- look up "which tasks were cascade-deleted because of this parent",
-- i.e. `where deleted_via_task_id = :parentId` — indexed here so that
-- lookup doesn't require a sequential scan once this table has any real
-- volume.
create index if not exists tasks_deleted_via_task_id_idx
  on tasks (deleted_via_task_id);

-- ---------------------------------------------------------------------
-- RPC: atomic cascade soft-delete
-- ---------------------------------------------------------------------
--
-- Soft-deletes `p_task_id` itself (only if it is not already deleted —
-- mirrors deleteTask's existing idempotent-safe "not found" convention;
-- this is a defense-in-depth no-op guard, since lib/actions/tasks.ts
-- already pre-checks the task exists and is not deleted before calling
-- this RPC) and, in the same transaction, soft-deletes every currently-
-- live direct child (`parent_task_id = p_task_id and deleted_at is
-- null`), stamping `deleted_via_task_id = p_task_id` on each cascaded
-- child. A child that was ALREADY soft-deleted before this call (deleted
-- independently, not via this parent) is excluded by the `deleted_at is
-- null` filter and is therefore left exactly as it was — its own
-- `deleted_via_task_id` (null, since it was deleted directly) is
-- untouched, which is precisely the provenance distinction F189's restore
-- will need.
--
-- `now()` is called twice below (once per UPDATE) but both calls return
-- the identical value: within one Postgres transaction/function
-- invocation, `now()` is stable for the whole transaction, so the parent
-- and its cascaded children always get byte-identical `deleted_at`
-- timestamps.
--
-- Returns the parent task's own post-update `id`/`deleted_at` — the
-- minimum the calling Server Action needs to build its discriminated-
-- union result, same shape deleteTask returned before this feature.
create or replace function public.cascade_delete_task(p_task_id uuid)
returns table (id uuid, deleted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  update tasks
    set deleted_at = now()
    where tasks.id = p_task_id
      and tasks.deleted_at is null;

  update tasks
    set deleted_at = now(),
        deleted_via_task_id = p_task_id
    where tasks.parent_task_id = p_task_id
      and tasks.deleted_at is null;

  return query
    select t.id, t.deleted_at
    from tasks t
    where t.id = p_task_id;
end;
$$;

revoke all on function public.cascade_delete_task(uuid) from public;
grant execute on function public.cascade_delete_task(uuid) to service_role;
