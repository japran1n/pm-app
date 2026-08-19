-- F145: project keys and per-project task numbers
-- (AS-257, AS-259, AS-260, AS-261)
--
-- Depends on: F132 in the feature spec, but F132 (project-visibility RLS
-- helper `is_project_visible_to()`) has NOT been built yet — M11 lands
-- later than M13 in this mission's plan. This migration therefore does NOT
-- call or invent `is_project_visible_to()`. It adds no new RLS policies at
-- all: `key`/`task_counter`/`number` are plain columns on `projects`/
-- `tasks`, already covered end-to-end by the existing mission-1 policies
--   projects_select_active_members / projects_update_active_members
--     (supabase/migrations/20260818004709_rls_projects.sql)
--   tasks_select_active_members / tasks_insert_active_members /
--   tasks_update_active_members
--     (supabase/migrations/20260818013805_rls_tasks.sql)
-- both of which already scope through workspace_members via
-- is_active_workspace_member/is_project_workspace_member. Adding a new
-- column to an already-RLS-covered table needs no new policy. When F132
-- lands, its sweep should double check these existing policies (see the
-- explicit checklist at the bottom of this file) rather than assume this
-- migration is a gap.
--
-- Scope note (Clarified implementation "Touches" answer): this feature's
-- file list is `supabase/migrations/` + `lib/supabase/database.types.ts`
-- only — no Server Action changes. Key/number assignment is therefore
-- implemented entirely at the database layer via BEFORE INSERT triggers,
-- so every insert path (the existing admin-client Server Actions in
-- lib/actions/projects.ts / lib/actions/tasks.ts, any future direct
-- authenticated-role insert, and raw test fixtures) gets a key/number for
-- free with no application code change required.

-- ---------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------

alter table projects
  add column if not exists key text,
  add column if not exists task_counter integer not null default 0;

alter table tasks
  add column if not exists number integer;

-- task_counter is a monotonically-increasing counter column, NOT a count of
-- live tasks and NOT derived from max(number). It only ever goes up (see
-- assign_task_number() below), which is what makes AS-260 (numbers never
-- reused after a task is deleted) hold even though tasks are soft-deleted:
-- a deleted task's number stays "spent" forever because the counter that
-- produced it never decrements and is never recomputed from row counts.

-- ---------------------------------------------------------------------
-- Key derivation: base key from a project name
-- ---------------------------------------------------------------------
--
-- Deterministic, dependency-free, pure-SQL algorithm (Clarified
-- implementation: "the simpler option that adds no new dependency and no
-- second source of truth"):
--   - 2+ words with a leading letter -> initials of up to the first 6 such
--     words (e.g. "Product Marketing" -> "PM").
--   - otherwise (single word, or fewer than 2 usable initials) -> the
--     first 6 letters of the name with all non-letters stripped (e.g.
--     "Marketing" -> "MARKET"), padded with 'X' if only 1 letter, or
--     falling back to 'PRJ' if the name has no letters at all.
-- Always uppercase, always starts with a letter, always 2-6 characters —
-- matching the `projects_key_format` CHECK added below.
create or replace function public.derive_project_key_base(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  words text[];
  w text;
  first_letter text;
  initials text := '';
  letters_only text;
  base text;
begin
  words := regexp_split_to_array(btrim(coalesce(p_name, '')), '\s+');

  foreach w in array words loop
    first_letter := substr(upper(regexp_replace(w, '[^A-Za-z]', '', 'g')), 1, 1);
    if first_letter <> '' then
      initials := initials || first_letter;
    end if;
    exit when length(initials) >= 6;
  end loop;

  if length(initials) >= 2 then
    return left(initials, 6);
  end if;

  letters_only := upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z]', '', 'g'));

  if length(letters_only) = 0 then
    base := 'PRJ';
  elsif length(letters_only) = 1 then
    base := letters_only || 'X';
  else
    base := left(letters_only, 6);
  end if;

  return base;
end;
$$;

revoke all on function public.derive_project_key_base(text) from public;
grant execute on function public.derive_project_key_base(text) to authenticated, anon, service_role;

-- ---------------------------------------------------------------------
-- Key derivation: resolve collisions within a workspace
-- ---------------------------------------------------------------------
--
-- Deterministic disambiguation rule (this migration's answer to the
-- "two projects both named Marketing" note in the feature spec / the
-- clarification file's "record the choice in the handoff" instruction):
-- the base key goes to whichever project is resolved FIRST — for the
-- one-time backfill below that means creation order (oldest created_at
-- wins the bare base key), and for ordinary runtime inserts that means
-- whichever insert's trigger runs first. Every later collision on the
-- same base within the same workspace appends the smallest unused integer
-- suffix starting at 2 (base, base2, base3, ...), trimming the base so the
-- combined candidate never exceeds 6 characters. This function is the
-- single source of truth for that rule — both the BEFORE INSERT trigger
-- below and the historical backfill DO block call it, so "how a new
-- project gets its key" and "how a pre-existing project gets its key
-- retroactively" are provably the same algorithm, not two copies that
-- could drift apart.
create or replace function public.generate_unique_project_key(p_workspace_id uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  suffix int := 1;
  suffix_text text;
  attempt int := 0;
  max_attempts int := 9000;
begin
  base := public.derive_project_key_base(p_name);
  candidate := base;

  while exists (
    select 1 from projects where workspace_id = p_workspace_id and key = candidate
  ) loop
    suffix := suffix + 1;
    suffix_text := suffix::text;
    candidate := left(base, greatest(2, 6 - length(suffix_text))) || suffix_text;
    attempt := attempt + 1;
    if attempt > max_attempts then
      raise exception
        'could not generate a unique project key for workspace % (base %)',
        p_workspace_id, base;
    end if;
  end loop;

  return candidate;
end;
$$;

revoke all on function public.generate_unique_project_key(uuid, text) from public;
grant execute on function public.generate_unique_project_key(uuid, text) to authenticated, anon, service_role;

-- ---------------------------------------------------------------------
-- Trigger: auto-derive a project's key on insert (AS-257)
-- ---------------------------------------------------------------------
--
-- SECURITY DEFINER so key assignment never depends on the inserting
-- role's own UPDATE/SELECT privileges on `projects` (same rationale as
-- create_workspace_with_owner / start_timer_atomic elsewhere in this
-- schema) — it only fires for rows the tasks_insert-equivalent
-- projects_insert_active_members RLS policy already allowed to be
-- inserted, so this does not widen who can create a project, only
-- guarantees the row that gets created has a key.
--
-- Only fires when the caller didn't already supply a key (`NEW.key is
-- null`), so an explicit, pre-validated key (e.g. a future "custom key at
-- creation" feature) is respected rather than overwritten. Any key value,
-- explicit or generated, is still bound by the projects_key_format CHECK
-- and the projects_key_unique_per_workspace UNIQUE constraint added below.
create or replace function public.assign_project_key()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.key is null then
    new.key := public.generate_unique_project_key(new.workspace_id, new.name);
  end if;
  return new;
end;
$$;

drop trigger if exists projects_assign_key on projects;
create trigger projects_assign_key
  before insert on projects
  for each row
  execute function public.assign_project_key();

-- ---------------------------------------------------------------------
-- Trigger: atomically assign a task's per-project number (AS-259, AS-260)
-- ---------------------------------------------------------------------
--
-- This is the crux of AS-259. The number is produced by
--   UPDATE projects SET task_counter = task_counter + 1
--   WHERE id = NEW.project_id
--   RETURNING task_counter INTO NEW.number
-- run as part of the SAME BEFORE INSERT trigger invocation as the task
-- row's own insert — i.e. inside the same statement/transaction as the
-- INSERT into tasks, never a separate `select max(number)+1` read
-- followed by a second write. Two concurrent transactions inserting a
-- task into the same project both attempt this UPDATE on the same
-- `projects` row; Postgres's row-level locking means the second
-- transaction's UPDATE blocks until the first COMMITs (or ROLLBACKs), at
-- which point it sees the already-incremented counter and increments
-- again — so no two concurrent inserts can ever observe/claim the same
-- task_counter value. This is the standard atomic-counter idiom and is
-- the same mechanism used in Postgres for e.g. sequence-free ordered
-- numbering; it holds regardless of the client's statement_timeout or
-- how many rows are inserted concurrently, unlike a max(number)+1 read
-- which races because the read and the write are two separate
-- statements with a window between them.
--
-- SECURITY DEFINER for the same reason as assign_project_key(): task
-- number assignment must not depend on the inserting role also holding
-- UPDATE privilege (via RLS) on the parent `projects` row — it is purely
-- internal bookkeeping, gated only by the fact that this trigger only
-- runs for rows the tasks_insert_active_members RLS policy already
-- allowed to be inserted.
create or replace function public.assign_task_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
begin
  if new.number is null then
    update projects
    set task_counter = task_counter + 1
    where id = new.project_id
    returning task_counter into v_number;

    if v_number is null then
      raise exception 'project % not found for task number assignment', new.project_id;
    end if;

    new.number := v_number;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_assign_number on tasks;
create trigger tasks_assign_number
  before insert on tasks
  for each row
  execute function public.assign_task_number();

-- ---------------------------------------------------------------------
-- Historical backfill (AS-261)
-- ---------------------------------------------------------------------
--
-- Runs once, here, in the same migration that adds the readers (per this
-- feature's "empty/zero state" clarified answer: "backfills named in the
-- spec run in the same migration"). Both loops are ordered by
-- (created_at, id) — id as a deterministic tiebreaker for rows sharing an
-- identical created_at timestamp, since two rows can otherwise tie and
-- Postgres gives no guaranteed order for equal sort keys.
--
-- Projects: processed oldest-first, calling the exact same
-- generate_unique_project_key() used by the trigger above. Because this
-- runs inside one transaction, each iteration's UPDATE is visible to the
-- next iteration's collision check (same-transaction reads see
-- same-transaction writes), which is what makes the "oldest project wins
-- the bare base key, every later same-named project gets base2, base3..."
-- rule actually hold across the whole backfill, not just within a single
-- trigger invocation.
do $$
declare
  proj record;
  new_key text;
begin
  for proj in
    select id, workspace_id, name
    from projects
    where key is null
    order by created_at, id
  loop
    new_key := public.generate_unique_project_key(proj.workspace_id, proj.name);
    update projects set key = new_key where id = proj.id;
  end loop;
end;
$$;

-- Tasks: numbered per-project, oldest-first, via the same "increment
-- task_counter, stamp the row" shape as the trigger — expressed as a
-- window function for a set-based backfill instead of a per-row PL/pgSQL
-- loop (equivalent result, cheaper for however much historical data
-- exists), then the owning project's task_counter is advanced to match
-- the highest number just assigned so future trigger-assigned numbers
-- continue the same sequence with no gap and no reuse.
with numbered as (
  select
    id,
    project_id,
    row_number() over (partition by project_id order by created_at, id) as rn
  from tasks
  where number is null
)
update tasks t
set number = n.rn
from numbered n
where t.id = n.id;

update projects p
set task_counter = counts.max_number
from (
  select project_id, max(number) as max_number
  from tasks
  group by project_id
) counts
where counts.project_id = p.id
  and counts.max_number > p.task_counter;

-- ---------------------------------------------------------------------
-- Constraints (added after backfill so existing rows already satisfy them)
-- ---------------------------------------------------------------------

alter table projects
  alter column key set not null;

alter table projects
  add constraint projects_key_format check (key ~ '^[A-Z][A-Z0-9]{1,5}$');

alter table projects
  add constraint projects_key_unique_per_workspace unique (workspace_id, key);

alter table tasks
  alter column number set not null;

alter table tasks
  add constraint tasks_number_positive check (number > 0);

create unique index if not exists tasks_project_id_number_idx
  on tasks (project_id, number);

-- Index strategy: workspace_id is already indexed (projects_workspace_id_idx,
-- 20260818004413_create_projects.sql) and project_id is already indexed
-- (tasks_project_id_idx, 20260818013434_create_tasks.sql) — both are the
-- FK/lookup columns this feature's own queries (a workspace-scoped key
-- lookup, a project-scoped number lookup) would filter on, and the new
-- tasks_project_id_number_idx above additionally covers "find task by
-- project_id + number" (the AS-262/F147 search lookup) and doubles as the
-- uniqueness guarantee for AS-259/AS-260.

-- ---------------------------------------------------------------------
-- F132 sweep checklist (explicit, per this feature's dependency
-- correction — F132's "project-visible-to" RLS pass should treat this as
-- a checklist, not rely on memory of what F145 touched):
--   - No new RLS policy was added by this migration. `projects.key`,
--     `projects.task_counter`, and `tasks.number` are covered by the
--     EXISTING policies:
--       projects_select_active_members, projects_insert_active_members,
--       projects_update_active_members (20260818004709_rls_projects.sql)
--       tasks_select_active_members, tasks_insert_active_members,
--       tasks_update_active_members (20260818013805_rls_tasks.sql)
--   - No new CHECK/UNIQUE constraint here references project visibility —
--     projects_key_format, projects_key_unique_per_workspace,
--     tasks_number_positive, and the tasks_project_id_number_idx unique
--     index are all format/uniqueness rules independent of who can see a
--     row.
--   - Two new SECURITY DEFINER functions were added:
--       public.assign_project_key() / public.assign_task_number()
--     (triggers, not callable directly by client roles beyond their
--     trigger use) and
--       public.derive_project_key_base(text) /
--       public.generate_unique_project_key(uuid, text)
--     (granted EXECUTE to authenticated/anon/service_role — pure
--     key-derivation logic, take no row-visibility shortcuts, and do not
--     need to change when F132 lands).
--   - Nothing in this migration calls or assumes the existence of
--     `is_project_visible_to()`.
