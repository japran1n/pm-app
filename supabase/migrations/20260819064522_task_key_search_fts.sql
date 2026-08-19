-- F147 (AS-262): make a task's "KEY-NUMBER" identifier (e.g. "PM-142",
-- see lib/tasks/task-key.ts's formatTaskKey, F146) part of the tasks
-- full-text search vector, so partial key matches ("PM", "142") work
-- through the same `search_tasks` RPC (20260818050300_fts_tasks_search_fn.sql)
-- that already ranks title/description matches. Exact key lookups
-- ("PM-142", "pm142", "pm 142") are resolved directly in
-- lib/queries/search.ts via lib/tasks/task-key.ts's parseTaskKeyQuery and
-- ranked above these full-text hits — this migration only widens what the
-- FTS vector itself can match.
--
-- Why this can't stay a GENERATED column: 20260818050200_fts_tasks.sql's
-- `search_vector` is `generated always as (...) stored`, computed purely
-- from columns on the SAME row (title, description). A task's key is
-- `projects.key || '-' || tasks.number` — it needs a value from a
-- DIFFERENT table (the owning project's key), and Postgres generated
-- columns can only reference columns of the row being written, never
-- another table. So `search_vector` is converted here from a generated
-- column into an ordinary stored column, maintained by a BEFORE INSERT OR
-- UPDATE trigger that looks up the owning project's key.
--
-- Known limitation (documented, not fixed here — no project-key-edit UI
-- exists yet per F146's handoff "Out-of-scope work needed", so this is
-- currently unreachable in practice): this trigger fires on writes to
-- `tasks`, not on writes to `projects`. If a project's key is ever
-- renamed by a future feature, every existing task's stored
-- search_vector keeps searching under the OLD key until that task is
-- next updated. `formatTaskKey` (the DISPLAYED key) is unaffected — it
-- always reads the project's current key live, per F146's Decisions
-- Made — only the FTS index of already-written rows would lag. A future
-- "rename project key" feature should add a companion trigger on
-- `projects` (or a fan-out re-index) alongside its own migration; adding
-- one now with no caller would be unverifiable dead code.

-- ---------------------------------------------------------------------
-- Convert search_vector from a generated column to an ordinary column
-- ---------------------------------------------------------------------
-- Drop the GIN index first — it depends on the column and Postgres won't
-- drop a generated column expression out from under a live index.
drop index if exists tasks_search_vector_idx;

alter table tasks drop column if exists search_vector;

alter table tasks add column search_vector tsvector;

-- ---------------------------------------------------------------------
-- Trigger function: recompute search_vector on insert/update, including
-- the owning project's key (AS-262's "partial matches still work" half)
-- ---------------------------------------------------------------------
-- Weighted the same as before (title 'A', description 'B'), plus the
-- task's "KEY-NUMBER" string at weight 'A' — the key is as strong an
-- identifier as the title, so a partial-key search ranks alongside
-- title matches rather than behind them. Uses the 'simple' text search
-- config (no English stemming/stopwords) for the key specifically, since
-- it's an identifier, not prose; Postgres's default parser still splits
-- a hyphenated token like "PM-142" into the compound lexeme plus its
-- parts ("pm-142", "pm", "142"), which is what makes a bare "PM" or
-- "142" query match via search_tasks's plainto_tsquery.
--
-- `security definer` so this trigger's cross-table SELECT on `projects`
-- never depends on the inserting/updating role's own RLS-visibility of
-- that row — same rationale as assign_task_number() in
-- 20260819061129_project_keys_and_task_numbers.sql, and safe for the same
-- reason: it only ever fires for rows the tasks_insert_active_members /
-- tasks_update_active_members RLS policies already allowed to be written,
-- and it does not expose the looked-up project row to the caller, only
-- folds its key into a derived search index value on the task itself.
create or replace function public.tasks_update_search_vector()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_key text;
  v_task_key text;
begin
  select key into v_project_key from projects where id = new.project_id;

  if v_project_key is not null and new.number is not null and new.number > 0 then
    v_task_key := v_project_key || '-' || new.number::text;
  else
    v_task_key := '';
  end if;

  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(new.description, '')), 'B')
    || setweight(to_tsvector('simple', v_task_key), 'A');

  return new;
end;
$$;

drop trigger if exists tasks_search_vector_trigger on tasks;
create trigger tasks_search_vector_trigger
  before insert or update of title, description, number, project_id on tasks
  for each row
  execute function public.tasks_update_search_vector();

-- ---------------------------------------------------------------------
-- Backfill: recompute search_vector for every existing row
-- ---------------------------------------------------------------------
-- The trigger above only fires for future inserts/updates. Every task
-- that already existed before this migration (including tasks backfilled
-- with keys/numbers by 20260819061129) needs its search_vector recomputed
-- once here, or it stays findable by title/description but NOT by key —
-- exactly the gap this migration exists to close.
update tasks t
set search_vector =
  setweight(to_tsvector('english', coalesce(t.title, '')), 'A')
  || setweight(to_tsvector('english', coalesce(t.description, '')), 'B')
  || setweight(
       to_tsvector(
         'simple',
         case
           when p.key is not null and t.number is not null and t.number > 0
             then p.key || '-' || t.number::text
           else ''
         end
       ),
       'A'
     )
from projects p
where p.id = t.project_id;

-- ---------------------------------------------------------------------
-- Recreate the GIN index dropped above
-- ---------------------------------------------------------------------
create index if not exists tasks_search_vector_idx
  on tasks using gin (search_vector);
