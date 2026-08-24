-- F239 follow-up (orchestrator-directed, same family as F322/F323):
-- close a real privilege-escalation/data-leak hole left by the
-- 20260821140526_project_visibility_rls_sweep.sql migration.
--
-- That sweep's own INSERT policy on task_dependencies already checks
-- BOTH sides:
--
--   task_dependencies_insert_active_members ... with check (
--     public.is_task_visible_to(blocking_task_id)
--     and public.is_task_visible_to(blocked_task_id)
--   );
--
-- but its SELECT and DELETE policies only ever checked the BLOCKING
-- side:
--
--   task_dependencies_select_active_members ... using (
--     public.is_task_visible_to(blocking_task_id)
--   );
--   task_dependencies_delete_active_members ... using (
--     public.is_task_visible_to(blocking_task_id)
--   );
--
-- The asymmetry with INSERT is the proof this was an oversight in the
-- sweep, not a deliberate design choice. Two real consequences, both in
-- the same "mutate/read data behind a visibility boundary" class F322/
-- F323 exist to close:
--
--   1. READ LEAK: a workspace member who can see the BLOCKING task but
--      NOT the BLOCKED task (e.g. the blocked task sits in a private
--      project they are not a member of) could still SELECT the
--      task_dependencies row and learn the blocked task's raw id --
--      information about a task's existence and relationship they
--      should never have. F239's own `getTimelineDependencyEdges`
--      (lib/queries/timeline.ts) already added an app-level `.in()`
--      constraint on BOTH endpoints as defense in depth for the
--      timeline's own read path specifically, but that constraint
--      protects nothing else that reads this table directly.
--   2. WRITE-SIDE PRIVILEGE ESCALATION (worse, and not covered by any
--      app-level workaround): the same one-sided DELETE policy let that
--      same caller actually DELETE a dependency row whose BLOCKED task
--      is in a project they cannot see -- a real mutation against
--      invisible data, not merely a read leak.
--
-- Fix: recreate both policies with the SAME two-sided check the INSERT
-- policy already uses. `is_task_visible_to()` itself is unchanged (no
-- new predicate function -- reused exactly as the sweep migration
-- defined it); only these two policies' `using` clauses are widened
-- from "blocking side visible" to "blocking side visible AND blocked
-- side visible", matching the read/write symmetry every other row in
-- this table's own lifecycle already assumes (AS-285's cross-workspace
-- trigger, this same file's own not-self/unique-pair constraints).
--
-- No table, column, index, or trigger change. No RPC change here --
-- get_dependency_ancestors/get_dependency_descendants
-- (20260819104900_dependency_reachability_functions.sql) are
-- `language sql stable`, NOT `security definer` (their own header
-- comment says so explicitly), so they already run under the CALLING
-- role and were already subject to task_dependencies' RLS the whole
-- time -- this migration's policy fix automatically tightens what rows
-- those functions can walk too, with no separate change needed. (Their
-- one real caller, lib/actions/dependencies.ts's getDependencyCandidates,
-- invokes them through the ADMIN client, which bypasses RLS by design --
-- a pre-existing, separate posture unrelated to this policy fix; see
-- this migration's own trailing checklist note and this feature's
-- handoff "Out-of-scope work needed" for that finding.)

drop policy if exists task_dependencies_select_active_members on task_dependencies;
create policy task_dependencies_select_active_members
  on task_dependencies
  for select
  to authenticated
  using (
    public.is_task_visible_to(blocking_task_id)
    and public.is_task_visible_to(blocked_task_id)
  );

drop policy if exists task_dependencies_delete_active_members on task_dependencies;
create policy task_dependencies_delete_active_members
  on task_dependencies
  for delete
  to authenticated
  using (
    public.is_task_visible_to(blocking_task_id)
    and public.is_task_visible_to(blocked_task_id)
  );

-- ---------------------------------------------------------------------
-- F132-style sweep checklist addendum (mirrors the format every prior
-- RLS-affecting migration in this codebase ends with):
--   - Policies changed (2): task_dependencies_select_active_members,
--     task_dependencies_delete_active_members -- both widened from a
--     one-sided `is_task_visible_to(blocking_task_id)` check to the
--     same two-sided check task_dependencies_insert_active_members
--     already used. No policy removed, no new policy added, no table/
--     column/index/trigger touched.
--   - Fallout audited (real callers of task_dependencies, all reviewed
--     against this behaviour change -- see this feature's handoff for
--     the per-site notes):
--       * lib/actions/dependencies.ts's createDependency/
--         deleteDependency: both already independently re-check
--         membership via requireActiveMembership and resolve both
--         tasks via the ADMIN client for their own lookups/error
--         messages BEFORE the real RLS-scoped insert/delete -- neither
--         function's own behaviour changes for a caller who could
--         already see both tasks (the only case either action's own
--         UI ever offers a dependency for in the first place); a
--         caller who could see only the blocking side and attempted a
--         DELETE against a row with an invisible blocked side now
--         correctly gets 0 rows affected instead of a silent delete --
--         deleteDependency's existing "not found" style response
--         already covers a 0-row delete gracefully.
--       * getDependencyCandidates (same file): calls the two
--         reachability RPCs and reads task_dependencies THROUGH THE
--         ADMIN CLIENT, which bypasses RLS by design (unrelated to
--         this policy fix -- flagged as out-of-scope follow-up work,
--         not touched here).
--       * lib/actions/tasks.ts's getOpenBlockers / the board's open-
--         blocker-count path: both query task_dependencies through the
--         ADMIN CLIENT for the same "resolve the true state regardless
--         of the caller's own RLS visibility, then apply visibility
--         checks explicitly in TypeScript" pattern this codebase uses
--         throughout -- unaffected by an RLS policy that only the
--         plain session client is ever subject to.
--       * get_project_board_tasks (the board RPC,
--         20260819110000_rpc_project_board_tasks.sql and its later
--         column-adding siblings): does not select from
--         task_dependencies at all (open-blocker COUNTING happens in
--         TypeScript via getOpenBlockers above, not in the board RPC
--         itself) -- no fallout.
--       * lib/queries/timeline.ts's getTimelineDependencyEdges (F239):
--         already runs through the plain RLS-scoped session client and
--         already independently constrains both endpoints via `.in()`
--         at the application layer -- this policy fix is now strictly
--         redundant defense-in-depth for that one call site, kept
--         deliberately rather than removed.
-- ---------------------------------------------------------------------
