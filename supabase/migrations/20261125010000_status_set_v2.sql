-- Ad-hoc status redesign (product owner request, 2026-09-12): replaces the
-- default four-status set (todo / in_progress / in_review / done) with an
-- 11-status set grouped into four DISPLAY sections a PM sees in the status
-- dropdown: "Not started" (Backlog, To Do, Blocked, Canceled), "Active"
-- (In Design, In Dev, QA by Dev, QA by Design, Awaiting Client), "Done"
-- (Approved), and "Closed" (Completed).
--
-- `project_statuses_category_check` (20260824010000_project_statuses.sql)
-- is NOT touched — it still only admits ('not_started', 'in_progress',
-- 'done'), per this migration's explicit instruction. "Done" and "Closed"
-- both map onto the DB category `done`; the only way to tell them apart
-- for the dropdown's section header is the new nullable `display_group`
-- column added below, read by lib/board/status-icons.ts's
-- resolveStatusGroup.
--
-- Category mapping used by every row inserted here:
--   not_started -> Backlog, To Do, Blocked, Canceled
--   in_progress -> In Design, In Dev, QA by Dev, QA by Design, Awaiting Client
--   done        -> Approved, Completed

-- ---------------------------------------------------------------------
-- 1. New nullable display_group column.
-- ---------------------------------------------------------------------

alter table project_statuses add column if not exists display_group text;

alter table project_statuses drop constraint if exists project_statuses_display_group_check;
alter table project_statuses add constraint project_statuses_display_group_check
  check (display_group is null or display_group in ('not_started', 'active', 'done', 'closed'));

-- ---------------------------------------------------------------------
-- 2. seed_default_project_statuses: new default for every FUTURE project.
-- ---------------------------------------------------------------------

create or replace function public.seed_default_project_statuses(target_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into project_statuses (project_id, name, color, category, display_group, position, client_description)
  values
    (target_project_id, 'Backlog', '#64748b', 'not_started', 'not_started', 1000, 'Not yet planned.'),
    (target_project_id, 'To Do', '#64748b', 'not_started', 'not_started', 2000, 'Planned. Work has not started yet.'),
    (target_project_id, 'Blocked', '#ea580c', 'not_started', 'not_started', 3000, 'Blocked -- waiting on something before work can continue.'),
    (target_project_id, 'Canceled', '#ef4444', 'not_started', 'not_started', 4000, 'Will not be completed.'),
    (target_project_id, 'In Design', '#7c3aed', 'in_progress', 'active', 5000, 'In design.'),
    (target_project_id, 'In Dev', '#3b82f6', 'in_progress', 'active', 6000, 'The team is actively working on this.'),
    (target_project_id, 'QA by Dev', '#3b82f6', 'in_progress', 'active', 7000, 'In developer QA.'),
    (target_project_id, 'QA by Design', '#3b82f6', 'in_progress', 'active', 8000, 'In design QA.'),
    (target_project_id, 'Awaiting Client', '#64748b', 'in_progress', 'active', 9000, 'Waiting on the client.'),
    (target_project_id, 'Approved', '#16a34a', 'done', 'done', 10000, 'Approved.'),
    (target_project_id, 'Completed', '#16a34a', 'done', 'closed', 11000, 'Delivered.')
  on conflict (project_id, name) do nothing;
end;
$$;

revoke all on function public.seed_default_project_statuses(uuid) from public;
grant execute on function public.seed_default_project_statuses(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 3. Migrate EXISTING projects' statuses to the new 11-status set.
--
-- Best-effort old -> new name mapping, per this migration's own
-- instruction:
--   todo        -> To Do
--   in_progress -> In Dev
--   in_review   -> QA by Dev
--   done        -> Completed
-- Any other pre-existing status (a PM's own renamed/added column) maps by
-- its CATEGORY instead, since there is no reliable name-based guess for
-- an arbitrary custom name:
--   not_started -> To Do
--   in_progress -> In Dev
--   done        -> Completed
--
-- Tasks pointing at an old status (`status_id`) are repointed to the
-- mapped new status BEFORE the old row is deleted, so no task is ever
-- left with a dangling/null status reference (`tasks.status_id` has no
-- ON DELETE clause -- deleting a still-referenced row would fail outright,
-- which is exactly the safety net this order relies on).
-- ---------------------------------------------------------------------

do $$
declare
  v_project record;
  v_old_status record;
  v_new_status_id uuid;
  v_new_name text;
begin
  for v_project in select id from projects loop
    -- Ensure this project already has the new 11 (idempotent: `on
    -- conflict (project_id, name) do nothing` inside the function).
    perform public.seed_default_project_statuses(v_project.id);

    -- Repoint every task on this project's OLD statuses (any row that
    -- isn't one of the 11 new names) onto a mapped new status, then drop
    -- the old row.
    for v_old_status in
      select id, name, category
      from project_statuses
      where project_id = v_project.id
        and name not in (
          'Backlog', 'To Do', 'Blocked', 'Canceled',
          'In Design', 'In Dev', 'QA by Dev', 'QA by Design', 'Awaiting Client',
          'Approved', 'Completed'
        )
    loop
      v_new_name := case v_old_status.name
        when 'todo' then 'To Do'
        when 'in_progress' then 'In Dev'
        when 'in_review' then 'QA by Dev'
        when 'done' then 'Completed'
        else case v_old_status.category
          when 'not_started' then 'To Do'
          when 'in_progress' then 'In Dev'
          when 'done' then 'Completed'
          else 'To Do'
        end
      end;

      select id into v_new_status_id
      from project_statuses
      where project_id = v_project.id and name = v_new_name;

      update tasks
      set status_id = v_new_status_id
      where status_id = v_old_status.id;

      -- Legacy rows that never got a `status_id` backfilled (predates
      -- 20260824010000) matched by project + old status TEXT instead.
      update tasks
      set status_id = v_new_status_id, status = v_new_name
      where project_id = v_project.id
        and status_id is null
        and status = v_old_status.name;

      delete from project_statuses where id = v_old_status.id;
    end loop;
  end loop;
end;
$$;
