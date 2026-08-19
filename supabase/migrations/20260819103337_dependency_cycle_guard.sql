-- F156: reject a task dependency that would create a cycle (AS-278).
--
-- This is explicitly a RACE-CONDITION feature, not a graph-algorithm
-- feature. Detecting a cycle with a SELECT before the INSERT (whether in
-- application code or in a separate query) is a TOCTOU bug: two
-- concurrent inserts (A->B and B->A, say) can each run their own "would
-- this create a cycle?" check against the pre-insert state, each see no
-- existing edge that would close a loop, and both commit — the pair
-- together closes the exact cycle each check individually failed to see.
--
-- The fix has two parts, both inside this table's BEFORE INSERT trigger,
-- inside the SAME transaction as the write itself:
--
--   1. A transaction-scoped advisory lock, `pg_advisory_xact_lock`, keyed
--      on the dependency's workspace id. This is the concurrency
--      mechanism: dependencies never cross workspaces (AS-285's trigger
--      guarantees this), so every pair of tasks that could possibly
--      participate in the same cycle live in one workspace, and locking
--      on that single key fully serializes every concurrent dependency
--      insert that could race on that graph. The SECOND transaction in
--      any concurrent pair blocks on this lock until the FIRST commits or
--      rolls back — it is not released until the end of the holding
--      transaction (that's what makes it an *xact* lock, not a session
--      lock), so there is no window where both transactions hold it at
--      once. Postgres's default READ COMMITTED isolation means each
--      *statement* (not the whole transaction) takes a fresh snapshot of
--      committed data when it starts; because the recursive cycle check
--      below runs only AFTER the lock is acquired, the second
--      transaction's check statement necessarily starts (and takes its
--      snapshot) only once the first transaction's insert has already
--      committed (or the first transaction rolled back and released the
--      lock without writing anything) — so the second transaction's
--      check always sees whatever the first one actually wrote. Without
--      the lock, both transactions' checks could take their snapshots
--      concurrently, before either has committed, and neither would see
--      the other's edge — exactly the TOCTOU bug described above.
--   2. A recursive CTE, evaluated under that lock, walking the existing
--      `task_dependencies` edges outward from the newly-blocked task to
--      see whether it can already reach the newly-blocking task. If it
--      can, the new edge would close a loop, and the insert is rejected.
--
-- No separate "check" statement/RPC is ever a substitute for this: the
-- lock+check pair below is the ONLY place a dependency is allowed to be
-- validated for cycles. lib/actions/dependencies.ts (added by this same
-- feature) does not pre-check for cycles before inserting — it always
-- attempts the real insert and lets this trigger be the single source of
-- truth, then turns a rejected insert into a user-facing message.
--
-- Naming the conflict (AS-278: "...rejected with a message naming the
-- conflict"): when NEW.blocked_task_id can already reach NEW.blocking_
-- task_id via existing edges, NEW.blocked_task_id is — by definition of
-- what was just found — the task that already (directly or transitively)
-- blocks NEW.blocking_task_id. That is true no matter how long the
-- existing chain is (a direct A<->B pair or a longer A->B->C->A ring), so
-- naming NEW.blocked_task_id as "the conflicting task" is well-defined
-- for every cycle shape, not just the 2-cycle case, and requires no
-- extra graph walk beyond the boolean reachability check itself — the
-- caller already has this task's id as one of its own two insert
-- arguments. This trigger raises a plain-message exception carrying that
-- task's raw id (for logs/debugging); it does NOT attempt to format a
-- "KEY-NUMBER" display string in SQL — lib/tasks/task-key.ts's
-- formatTaskKey is the single source of that formatting, so the display
-- string is built by lib/actions/dependencies.ts (in TypeScript, via a
-- plain follow-up SELECT on the already-known conflicting task id) after
-- catching this trigger's rejection, never re-derived here.
create or replace function public.enforce_task_dependency_no_cycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_would_cycle boolean;
begin
  -- Resolve the workspace independently of the AS-285 same-workspace
  -- trigger (F155's `task_dependencies_enforce_same_workspace`) — trigger
  -- firing order between two BEFORE INSERT triggers on one table is not
  -- something this migration relies on. If the blocking task doesn't
  -- resolve to a real workspace, there is nothing to lock or check;
  -- let the insert proceed to whatever other constraint/trigger rejects
  -- a nonexistent task.
  select p.workspace_id
    into v_workspace_id
    from tasks t
    join projects p on p.id = t.project_id
    where t.id = new.blocking_task_id;

  if v_workspace_id is null then
    return new;
  end if;

  -- Concurrency mechanism: serialize every dependency insert for this
  -- workspace behind one transaction-scoped advisory lock before doing
  -- any cycle reasoning. See the header comment above for exactly why
  -- this closes the TOCTOU race a plain pre-insert SELECT cannot.
  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text, 0));

  -- Now that no concurrent dependency write for this workspace can be
  -- in flight, walk the existing edges outward from the task that would
  -- become blocked, to see whether it can already reach the task that
  -- would become blocking. If it can, the new edge closes a loop.
  with recursive reachable(task_id) as (
    select blocked_task_id
      from task_dependencies
      where blocking_task_id = new.blocked_task_id
    union
    select td.blocked_task_id
      from task_dependencies td
      join reachable r on td.blocking_task_id = r.task_id
  )
  select exists (
    select 1 from reachable where task_id = new.blocking_task_id
  )
  into v_would_cycle;

  if v_would_cycle then
    raise exception
      'task_dependency_cycle: task % already (directly or transitively) blocks task %, so it cannot also be blocked by it',
      new.blocked_task_id, new.blocking_task_id;
  end if;

  return new;
end;
$$;

drop trigger if exists task_dependencies_enforce_no_cycle on task_dependencies;
create trigger task_dependencies_enforce_no_cycle
  before insert on task_dependencies
  for each row
  execute function public.enforce_task_dependency_no_cycle();

-- ---------------------------------------------------------------------
-- F132 sweep checklist addendum (see the bottom of F155's
-- 20260819102618_task_dependencies.sql for the base checklist this
-- extends):
--   - One new trigger: task_dependencies_enforce_no_cycle, BEFORE
--     INSERT, executing public.enforce_task_dependency_no_cycle() — a
--     structural write-time integrity guard (like F155's same-workspace
--     trigger), independent of row visibility. No RLS predicate changed.
--   - No new table, column, policy, or index.
-- ---------------------------------------------------------------------
