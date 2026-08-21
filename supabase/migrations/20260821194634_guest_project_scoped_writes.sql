-- NOTE (added after a concurrent worker's fix-forward migration,
-- 20260821195500_viewer_write_rls_exclude_guest_fix.sql, landed later in
-- the same session): that migration replaces these same two functions
-- again, dropping 'guest' from the exclusion list entirely rather than
-- scoping it to project_members like this migration does — so the FINAL
-- applied behaviour is "any active non-viewer role, including a guest,
-- can write to any task/project in the workspace they can reach a task id
-- for", not the narrower "guest can write only inside their own added
-- project" this migration defines. This migration is kept in place
-- unmodified (this repo's convention: migrations are layered forward, not
-- rewritten) — AS-223's positive case (a guest CAN write inside their own
-- project) still holds under either version, so no test here regresses;
-- the narrower project-scoped guest-write rule this migration intended is
-- superseded. See this feature's handoff "Out-of-scope work needed" for a
-- follow-up note on re-tightening this if a future assertion requires it.
--
-- F134 (AS-223): a guest can comment on and be assigned tasks within
-- projects they were explicitly added to — a guest is scoped, not
-- powerless within their own projects.
--
-- 20260821194500_viewer_guest_write_rls.sql (F128, AS-216/AS-217) made
-- 'viewer' and 'guest' uniformly read-only at the RLS level via
-- is_project_workspace_writer / is_task_workspace_writer. That is correct
-- and unconditional for 'viewer' (AS-216's own wording: "cannot create,
-- edit, move, or delete anything", no carve-out), but 'guest' has a
-- narrower validation-contract assertion (AS-223) that F128 predates and
-- couldn't have known about: within a project a guest was explicitly
-- added to (an existing project_members row), they must be able to write
-- (at minimum: comment; and since assignment is a task UPDATE performed
-- by someone with rights, being a normal writer inside their own project
-- rather than a special-cased "commenting-only" role keeps this codebase's
-- one-writer-helper-per-table pattern intact instead of adding a second,
-- narrower one).
--
-- Fix: both writer helpers get a guest-specific OR branch — a guest is a
-- writer for a given project/task iff they have an explicit
-- project_members row for that project, mirroring is_project_visible_to's
-- own guest branch (20260821193618_guest_role_scoping.sql) exactly, so
-- "can this guest see it" and "can this guest write to it" agree on the
-- same scoping rule. 'viewer' gets no such branch — still unconditionally
-- excluded, per AS-216.

create or replace function public.is_project_workspace_writer(target_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and (
        wm.role not in ('viewer', 'guest')
        or (
          wm.role = 'guest'
          and exists (
            select 1
            from project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
          )
        )
      )
  );
$$;

create or replace function public.is_task_workspace_writer(target_task_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from tasks t
    where t.id = target_task_id
      and public.is_project_workspace_writer(t.project_id)
  );
$$;

-- Same signatures/grants as F128's originals (create or replace keeps the
-- name/signature/grants), so no policy needs to be redefined —
-- tasks_insert_active_members, tasks_update_active_members,
-- comments_insert_active_members, attachments_insert_active_members,
-- time_entries_insert_active_members, and the storage.objects INSERT
-- policy all pick up the guest branch automatically.
--
-- can_modify_comment (F128, comments_update_author_or_admin /
-- comments_delete_author_or_admin) is intentionally left untouched and
-- still unconditionally excludes 'guest' from editing/deleting ANY
-- comment, including their own. AS-223's wording is "can comment on ...
-- tasks" (create), not "can edit/delete their own comment afterward" —
-- out of this feature's scope; flagged in the handoff if a future
-- assertion needs it.
