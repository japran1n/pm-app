-- F325 (M16 scrutiny blockers A + B; AS-404, AS-411): fix two defects in
-- the F218/F219 board-column feature.
--
-- ---------------------------------------------------------------------
-- Blocker A (AS-411, and the board itself): renaming a column stranded
-- every task in it.
-- ---------------------------------------------------------------------
--
-- `updateColumn` (lib/actions/statuses.ts) renames only
-- `project_statuses.name`. `sync_task_status_and_status_id`
-- (20260824010000_project_statuses.sql) is `before insert or update on
-- tasks` -- it never fires on a `project_statuses` write, so
-- `tasks.status` text goes stale for every task in the renamed column.
-- The board (components/board/board.tsx) groups by
-- `task.status === column.name`, and the list filter (F223) also
-- compares against `tasks.status` text, so every task in a renamed
-- column vanishes from both surfaces.
--
-- AUTONOMOUS_DECISION (F325 worker): of the three options the spec
-- offered, this migration adds an `AFTER UPDATE OF name ON
-- project_statuses` trigger that propagates the rename onto
-- `tasks.status` for every task belonging to that column, rather than
-- (a) making `updateColumn` a two-statement Server Action -- explicitly
-- disallowed by this feature's own instructions, matching the house
-- "two statements must not be separable" rule the
-- `reassign_and_delete_project_status` RPC already follows -- or
-- (b) moving the board's grouping key from `column.name` to
-- `column.id`/`status_id`, which would require touching
-- `get_project_board_tasks`, `TaskCardTask`, the list query, every
-- filter surface, and multiple other in-flight/future features' read
-- paths well outside this feature's "Touches" scope, for a bigger
-- surface-area change than a single DB-level fix.
--
-- A trigger is chosen over inlining the update in `updateColumn` itself
-- because the scrutiny report explicitly asks for a fix that keeps
-- "ANY rename path" consistent -- including the
-- `reassign_and_delete_project_status` RPC's own defensive posture and
-- any future write path this table gains (tests, seed scripts, a future
-- admin tool) -- without every future caller needing to remember to
-- propagate the rename by hand. This mirrors `sync_task_status_and_
-- status_id`'s own justification for being a trigger rather than
-- application-code logic.
--
-- Matching is primarily by `status_id` (the durable, rename-proof FK
-- every task should already carry per the 20260824010000 backfill), with
-- a text-match fallback for the rare row that predates that backfill and
-- has not yet been touched (`status_id IS NULL AND status = old.name`).
-- The `tasks_sync_status_and_status_id` trigger requires no accompanying
-- change: setting `tasks.status = new.name` here re-enters that trigger
-- on the `tasks` update, which re-derives `status_id` from
-- `(project_id, name)` and finds the same row (its `id` never changed),
-- so `status` and `status_id` stay pinned to each other exactly as
-- before, just at the new name.
--
-- CASCADE safety: this trigger only fires on `UPDATE OF name`; it never
-- runs on `project_statuses` row deletion (column delete) or on the
-- `projects` -> `project_statuses` `ON DELETE CASCADE` path, so it adds
-- no obstruction to project hard-delete (F219's regression class).
-- Verified by `tests/integration/f325-status-rename-sync.test.ts`'s
-- "seed columns then hard-delete the project" case.

create or replace function public.sync_tasks_status_on_column_rename()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update tasks
    set status = new.name
    where status_id = new.id
       or (status_id is null and project_id = new.project_id and status = old.name);
  end if;
  return new;
end;
$$;

drop trigger if exists project_statuses_sync_task_status_on_rename on project_statuses;
create trigger project_statuses_sync_task_status_on_rename
  after update of name on project_statuses
  for each row
  execute function public.sync_tasks_status_on_column_rename();

-- ---------------------------------------------------------------------
-- Blocker B (AS-404): three of the four seeded default colours are not
-- in the approved palette (`COLUMN_COLOR_PALETTE`,
-- lib/board/column-colors.ts), so `updateColumn`'s Zod re-validation of
-- the (unchanged) colour rejects every rename of a default column.
-- ---------------------------------------------------------------------
--
-- AUTONOMOUS_DECISION (F325 worker): aligns the SEED colours to the
-- existing, already-shipped `COLUMN_COLOR_PALETTE` rather than widening
-- the palette to include the old seed hexes. The palette is the single
-- place the product's approved colours are defined (both the picker UI
-- and the Zod/DB-side `isApprovedColumnColor` check read from it) and
-- F219's own migration comment already says the palette reuses F087's
-- contrast-vetted set deliberately -- widening it to also include the
-- old, never-vetted seed hexes would create a second, larger "approved"
-- set with weaker guarantees and defeats that single-source-of-truth
-- intent. Aligning the seed keeps exactly one approved-colour list.
--
-- Mapping (nearest palette colour, same rough hue):
--   todo:        #94a3b8 (slate)  -> #64748b (Slate)
--   in_progress: #3b82f6 (blue)   -> unchanged, already in the palette
--   in_review:   #f59e0b (amber)  -> #d97706 (Amber)
--   done:        #22c55e (green)  -> #16a34a (Green)
--
-- Two parts, both required for one source of truth going forward:
--   1. `seed_default_project_statuses` (CREATE OR REPLACE) so every
--      NEW project's default columns are already renameable.
--   2. A one-time UPDATE of EXISTING rows, but ONLY where a column's
--      name AND colour still exactly match the original seed pair --
--      i.e. a column a user has never recoloured. This preserves any
--      deliberate customisation (F219/AS-405 lets an admin repaint a
--      default column) while fixing the common, unmodified case.

create or replace function public.seed_default_project_statuses(target_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into project_statuses (project_id, name, color, category, position)
  values
    (target_project_id, 'todo', '#64748b', 'not_started', 1000),
    (target_project_id, 'in_progress', '#3b82f6', 'in_progress', 2000),
    (target_project_id, 'in_review', '#d97706', 'in_progress', 3000),
    (target_project_id, 'done', '#16a34a', 'done', 4000)
  on conflict (project_id, name) do nothing;
end;
$$;

update project_statuses
set color = '#64748b'
where name = 'todo' and color = '#94a3b8';

update project_statuses
set color = '#d97706'
where name = 'in_review' and color = '#f59e0b';

update project_statuses
set color = '#16a34a'
where name = 'done' and color = '#22c55e';
