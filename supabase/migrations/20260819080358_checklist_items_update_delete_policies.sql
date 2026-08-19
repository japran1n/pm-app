-- F152: UPDATE + DELETE RLS policies for checklist_items (AS-270, AS-271)
--
-- Gap found by the orchestrator (not stated in F151's own handoff): F151's
-- migration (20260819075456_create_checklist_items.sql) shipped ONLY
-- SELECT and INSERT policies on checklist_items, mirroring F058's
-- create_comments.sql precedent of shipping UPDATE later. Under RLS,
-- UPDATE and DELETE are denied by default absent a matching policy, so
-- toggle/rename/reorder (all UPDATEs) and delete cannot succeed through
-- the normal authenticated Supabase client no matter what this feature's
-- Server Actions do in application code. This migration closes that gap.
--
-- Scoped IDENTICALLY to the two existing policies: through the same
-- `public.is_task_workspace_member(target_task_id)` SECURITY DEFINER
-- helper (F058, reused as-is by F151 for SELECT/INSERT). No new helper
-- function is created here — checklist_items.task_id has the same
-- tasks -> projects -> workspace_members join shape the helper already
-- covers.
--
-- Shape mirrors `tasks_update_active_members`
-- (supabase/migrations/20260818013805_rls_tasks.sql): any ACTIVE member of
-- the owning workspace, no per-item author/ownership restriction.
-- checklist_items are task-owned state (like a subtask or a status), not
-- user-authored content like a comment, so there is no author-or-admin
-- restriction here the way comments_update_author_or_admin has one — this
-- was called out explicitly in F151's handoff's "Out-of-scope work
-- needed" section as the expected shape for this follow-up policy.

-- UPDATE: covers toggle (AS-270), rename, and reorder (AS-271) — all three
-- are plain UPDATEs on this table, so one policy covers all of them. `with
-- check` re-validates `task_id` on the post-update row so a member cannot
-- use an UPDATE to re-point a checklist item at a task_id outside their
-- workspace (same cross-workspace-write guard as tasks_update_active_members
-- and checklist_items_insert_active_members).
create policy checklist_items_update_active_members
  on checklist_items
  for update
  to authenticated
  using (
    public.is_task_workspace_member(task_id)
  )
  with check (
    public.is_task_workspace_member(task_id)
  );

-- DELETE: covers AS-271's delete. checklist_items has no `deleted_at`
-- column (F151's migration deliberately omitted one — the feature spec's
-- Draft scope column set doesn't include it, unlike tasks/comments), so
-- "deleted" here is a real, hard DELETE rather than a soft-delete flag
-- flip. Scoped the same way as UPDATE: any active member of the item's
-- task's workspace.
create policy checklist_items_delete_active_members
  on checklist_items
  for delete
  to authenticated
  using (
    public.is_task_workspace_member(task_id)
  );

-- No policy is created for anon or for authenticated non-members: absence
-- of a matching policy means those rows are simply not updatable/deletable
-- (RLS default deny) — a non-member's UPDATE/DELETE affects zero rows
-- (Postgrest reports this as a successful no-op with an empty result under
-- .select().single(), which the action layer treats as a failure — see
-- lib/actions/checklist.ts), not an error, same "filtered, not errored"
-- behavior AS-274 already established for SELECT/INSERT.

-- ---------------------------------------------------------------------
-- F132 sweep checklist (explicit, continuing F151's convention — F132's
-- "project-visible-to" RLS pass should treat this as a checklist, not
-- rely on memory of what F151/F152 touched):
--   - Table: checklist_items (no new table here; F151 created it).
--   - Policies added by THIS migration (2): checklist_items_update_active_members,
--     checklist_items_delete_active_members — both scoped through the
--     EXISTING public.is_task_workspace_member(task_id) helper, no new RLS
--     function created.
--   - Combined with F151's SELECT/INSERT policies
--     (checklist_items_select_active_members,
--     checklist_items_insert_active_members), checklist_items now has all
--     four policy types (SELECT/INSERT/UPDATE/DELETE), all through the
--     same helper, all needing the same future upgrade.
--   - Constraints/indexes/triggers: unchanged by this migration (see
--     F151's migration for those).
--   - Nothing in this migration calls or assumes the existence of
--     `is_project_visible_to()`. When F132 lands, all four policies above
--     should be swept together to the new helper.
-- ---------------------------------------------------------------------
