-- F016c (missions/20260903-portal, M3-scrutiny.md B1 — blocker):
-- `client_deliverables.task_id` / `.phase_id` had no same-project
-- constraint, and both were written through the service-role client
-- (lib/actions/deliverables.ts:225,294) with no check against
-- ctx.projectId. Two live consequences, both fixed here:
--
--   1. `sweep_overdue_blocking_deliverables` (20260927010000:213-231)
--      joined `tasks t on t.id = cd.task_id` with nothing tying `t` to
--      `cd.project_id`, then resolved the Blocked status from the
--      DELIVERABLE's project — an hourly write of one project's status
--      onto another project's task.
--   2. `resolveHoldsUpContext` (lib/queries/deliverables.ts:174,192)
--      read `tasks`/`project_phases` through the admin client scoped
--      only by id, so a cross-project task title/phase name could
--      render as a "holds up" label in a workspace that has no
--      visibility into it.
--
-- Fix, per the feature's own preference: a composite foreign key over a
-- trigger, because the database should refuse the bad row for every
-- writer, including a future service-role caller who forgets — not just
-- the two call sites this migration also patches at the application
-- layer (lib/actions/deliverables.ts, defense in depth, not the only
-- check).
--
-- A composite FK on (task_id, project_id) needs a matching UNIQUE
-- constraint on tasks(id, project_id) to reference — `id` alone is
-- already the primary key, so this composite unique constraint is
-- satisfied by construction (id is unique on its own) and does not
-- change tasks' cardinality at all; it exists purely so a composite FK
-- can be declared against it. Same for project_phases(id, project_id).
--
-- ON DELETE SET NULL is scoped to the linking column only —
-- `on delete set null (task_id)` / `(phase_id)`, the PostgreSQL 15+
-- column-list form (this project runs Postgres 17, per
-- supabase/config.toml:41) — because the *unscoped* form of a composite
-- FK's ON DELETE SET NULL action nulls every column that participates in
-- the FK, which here would include `project_id`. That column is
-- `not null` on `client_deliverables`; nulling it on every task/phase
-- deletion would turn a routine task delete into a constraint violation
-- that aborts the delete. The column-list form nulls only the linking
-- column, exactly matching the single-column FK's prior behaviour.
--
-- Step 5, per this feature's own instruction and F006h's lesson: existing
-- rows were checked BEFORE writing this file (both queries below,
-- run against the live project via the Management API query endpoint —
-- see this feature's handoff for the exact statements and output).
-- Both returned zero rows:
--
--   select cd.id from client_deliverables cd join tasks t
--     on t.id = cd.task_id where t.project_id <> cd.project_id;
--   select cd.id from client_deliverables cd join project_phases p
--     on p.id = cd.phase_id where p.project_id <> cd.project_id;
--
-- The defensive UPDATEs below are kept anyway (idempotent, no-ops on
-- this database) so that this migration is also safe to run against any
-- other environment that already has a bad row: rather than fail at
-- deploy time (F006h's mistake), it nulls the offending link — the same
-- outcome a deleted task/phase already produces via ON DELETE SET NULL,
-- and strictly safer than leaving a row that silently disagreed with the
-- constraint this file is about to add.

-- ---------------------------------------------------------------------
-- 1. Null out any pre-existing cross-project links (no-op today; see
--    header for the verification queries and their zero-row result).
-- ---------------------------------------------------------------------
update client_deliverables cd
set task_id = null
from tasks t
where cd.task_id = t.id
  and t.project_id <> cd.project_id;

update client_deliverables cd
set phase_id = null
from project_phases p
where cd.phase_id = p.id
  and p.project_id <> cd.project_id;

-- ---------------------------------------------------------------------
-- 2. Composite unique constraints the new FKs reference.
-- ---------------------------------------------------------------------
alter table tasks
  add constraint tasks_id_project_id_key unique (id, project_id);

alter table project_phases
  add constraint project_phases_id_project_id_key unique (id, project_id);

-- ---------------------------------------------------------------------
-- 3. Replace the single-column FKs with composite, same-project FKs.
-- ---------------------------------------------------------------------
alter table client_deliverables
  drop constraint client_deliverables_task_id_fkey;

alter table client_deliverables
  add constraint client_deliverables_task_id_fkey
    foreign key (task_id, project_id)
    references tasks (id, project_id)
    on delete set null (task_id);

alter table client_deliverables
  drop constraint client_deliverables_phase_id_fkey;

alter table client_deliverables
  add constraint client_deliverables_phase_id_fkey
    foreign key (phase_id, project_id)
    references project_phases (id, project_id)
    on delete set null (phase_id);

-- ---------------------------------------------------------------------
-- 4. The sweep: only ever block a task with a deliverable from the
--    task's own project. Recreated in full (CREATE OR REPLACE), same
--    signature, same body except the added join predicate.
-- ---------------------------------------------------------------------
create or replace function public.sweep_overdue_blocking_deliverables()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_blocked_count integer := 0;
begin
  for v_row in
    select distinct on (t.id)
      t.id as task_id,
      cd.id as deliverable_id,
      cd.title as deliverable_title,
      t.status as previous_status,
      ps_blocked.id as blocked_status_id,
      ps_blocked.name as blocked_status_name
    from client_deliverables cd
    join tasks t on t.id = cd.task_id and t.project_id = cd.project_id
    join projects p on p.id = cd.project_id
    join lateral (
      select ps.id, ps.name
      from project_statuses ps
      where ps.project_id = cd.project_id
        and ps.client_bucket = 'blocked'
      order by ps.position asc
      limit 1
    ) ps_blocked on true
    where cd.blocking
      and cd.state not in ('accepted', 'waived')
      and cd.due_at is not null
      and cd.due_at < (now() at time zone 'utc')::date
      and t.deleted_at is null
      and p.deleted_at is null
      and t.status_id is distinct from ps_blocked.id
    order by t.id, cd.due_at asc, cd.position asc
  loop
    update tasks
       set status_id = v_row.blocked_status_id,
           status = v_row.blocked_status_name
     where id = v_row.task_id;

    perform public.write_task_activity_entry(
      p_task_id => v_row.task_id,
      p_kind => 'field_changed',
      p_field => 'status',
      p_old_value => to_jsonb(v_row.previous_status),
      p_new_value => jsonb_build_object(
        'status', v_row.blocked_status_name,
        'reason', 'client_deliverable_overdue',
        'deliverable_id', v_row.deliverable_id,
        'deliverable_title', v_row.deliverable_title
      ),
      p_system => true
    );

    v_blocked_count := v_blocked_count + 1;
  end loop;

  return v_blocked_count;
end;
$$;

comment on function public.sweep_overdue_blocking_deliverables() is
  'F013 (AS-030): hourly sweep moving a task into its project''s client_bucket = ''blocked'' column when a blocking client_deliverable linked to it is overdue and not yet accepted/waived. Only ever moves a task INTO blocked, never out; idempotent per task (see 20260927010000''s header comment). F016c: join is same-project only (t.project_id = cd.project_id), on top of the composite FK that now enforces this at write time.';
