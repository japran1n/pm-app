-- F157: dependency-picker reachability queries.
--
-- The critical context for this feature is explicit: "the task picker
-- should EXCLUDE tasks that would create a cycle, rather than letting
-- the user pick one and then showing an error... F156's reachability
-- logic already exists in SQL — expose it as a query rather than
-- reimplementing the graph walk in TypeScript."
--
-- F156's `enforce_task_dependency_no_cycle()` trigger
-- (20260819103337_dependency_cycle_guard.sql) already contains the one
-- correct recursive-CTE walk over `task_dependencies` for this graph.
-- This migration exposes that SAME walk, in both directions, as two
-- read-only `stable` SQL functions, so `lib/actions/dependencies.ts`'s
-- picker query can filter candidates without a second, parallel
-- TypeScript implementation of graph reachability ever existing.
--
-- Direction naming, worked through against the trigger's own semantics
-- (a `task_dependencies` row with `blocking_task_id = X`,
-- `blocked_task_id = Y` means "X blocks Y"):
--
--   - get_dependency_descendants(p_task_id): every task p_task_id
--     already (directly or transitively) blocks today — the exact
--     "reachable forward" set F156's trigger computes starting from
--     `new.blocked_task_id`. If a candidate task C is in this set,
--     inserting "C blocks p_task_id" would close a loop (p_task_id
--     already leads to C, and C would then lead back to p_task_id) — so
--     this is the exclusion set for the "Blocked by" picker (candidates
--     for "who blocks this task").
--   - get_dependency_ancestors(p_task_id): every task that already
--     (directly or transitively) blocks p_task_id today — the reverse
--     walk. If a candidate task C is in this set, inserting "p_task_id
--     blocks C" would close a loop (C already leads to p_task_id, and
--     p_task_id would then lead back to C) — so this is the exclusion
--     set for the "Blocks" picker (candidates for "what this task
--     blocks").
--
-- Neither function excludes p_task_id itself (AS-279, the self-
-- reference case) — that is the caller's job (one extra id in a Set),
-- exactly as `createDependencySchema`'s own not-self refinement already
-- handles it independently of cycle detection (see
-- lib/validation/dependencies.ts's header comment for why self-reference
-- and cycle detection are deliberately two separate mechanisms).
--
-- `language sql stable`, no `security definer` (default invoker rights):
-- mirrors F068's `search_tasks()` (20260818050300_fts_tasks_search_fn.sql)
-- exactly — these functions run under the calling role, so RLS on
-- `task_dependencies` (`task_dependencies_select_active_members`) still
-- applies to the rows they walk. This feature's own action layer calls
-- them via the admin client anyway, AFTER already independently
-- re-verifying the caller's membership (requireActiveMembership) — same
-- "admin client only for read-only lookups after membership is already
-- checked" convention `lib/actions/dependencies.ts` documents for its
-- other lookups — so invoker-rights here is defense in depth, not the
-- only gate.
--
-- No new table, column, policy, index, or trigger. Purely additive
-- read-only functions over the existing `task_dependencies` table.

create or replace function public.get_dependency_descendants(p_task_id uuid)
returns table (task_id uuid)
language sql
stable
as $$
  with recursive descendants(task_id) as (
    select blocked_task_id
      from task_dependencies
      where blocking_task_id = p_task_id
    union
    select td.blocked_task_id
      from task_dependencies td
      join descendants d on td.blocking_task_id = d.task_id
  )
  select task_id from descendants;
$$;

create or replace function public.get_dependency_ancestors(p_task_id uuid)
returns table (task_id uuid)
language sql
stable
as $$
  with recursive ancestors(task_id) as (
    select blocking_task_id
      from task_dependencies
      where blocked_task_id = p_task_id
    union
    select td.blocking_task_id
      from task_dependencies td
      join ancestors a on td.blocked_task_id = a.task_id
  )
  select task_id from ancestors;
$$;

-- ---------------------------------------------------------------------
-- F132 sweep checklist addendum (see the bottom of F155's/F156's own
-- migrations for the checklist this extends):
--   - Two new functions, both `security invoker` (the default — no
--     `security definer` keyword used), both `stable`, neither writing
--     anything. No RLS predicate changed, no new table/column/policy/
--     index/trigger — nothing for a row-visibility sweep to check here.
-- ---------------------------------------------------------------------
