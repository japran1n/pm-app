-- F170 (AS-310): rich-text storage for task descriptions.
--
-- Additive, non-destructive migration (per this mission's "additive
-- first" convention, established for tasks.assignee_id in F159, and the
-- clarified answer "additive, drop later" — the legacy plain-text column
-- is kept until every reader has migrated off it, per a future cleanup
-- feature, F270).
--
-- New columns:
--   tasks.description_json  jsonb  — Tiptap JSONContent document (F169's
--                                    `RichTextEditor`/`RichTextRenderer`
--                                    storage format). Nullable; null means
--                                    "no rich content set yet".
--   tasks.description_text  text   — plain-text projection of
--                                    description_json, used ONLY for
--                                    full-text search indexing. Never
--                                    rendered to users (F171 renders
--                                    description_json through
--                                    RichTextRenderer instead).
--
-- The rich-text editor (F169) is not yet wired into the task create/edit
-- UI or lib/actions/tasks.ts (that lands in a later feature per this
-- feature's scope note: "just the DB shape and backfill"). Until that
-- happens, the ONLY writer of task descriptions is still the plain
-- `tasks.description` column via lib/actions/tasks.ts. To honour the
-- clarified answer ("the plain projection must be produced server-side
-- ... so search never drifts from what is displayed") without touching
-- the Server Action layer (out of scope for this feature, and the
-- simpler option with no second source of truth), description_json and
-- description_text are derived FROM tasks.description by a trigger on
-- every insert/update, exactly mirroring the one-paragraph wrap this
-- migration's backfill applies to existing rows. Once a later feature
-- wires the rich-text editor into the write path and starts writing
-- description_json directly, this trigger's derivation must be flipped
-- (extract description_text FROM description_json instead of wrapping
-- description INTO description_json) — flagged in this feature's
-- handoff as required follow-up work.

alter table tasks
  add column if not exists description_json jsonb;

alter table tasks
  add column if not exists description_text text;

comment on column tasks.description is
  'DEPRECATED (F170): superseded by description_json (Tiptap JSONContent) and description_text (plain-text FTS projection). Kept read-only until every reader has migrated off it; scheduled for removal in a future cleanup feature (F270). Do not add new readers of this column.';

comment on column tasks.description_json is
  'F170/F169: Tiptap JSONContent rich-text document. Rendered read-only via components/editor/rich-text-editor.tsx''s RichTextRenderer (F171). Null means no content set.';

comment on column tasks.description_text is
  'F170: plain-text projection of description_json, maintained by tasks_update_search_vector() on every write. Used only to build tasks.search_vector for full-text search -- never rendered to users directly.';

-- ---------------------------------------------------------------------
-- Helper: wrap a plain-text string as a single-paragraph Tiptap document.
-- Empty/null text produces an empty doc (a doc with no paragraph child),
-- matching Tiptap's own empty-document shape.
-- ---------------------------------------------------------------------
create or replace function public.tiptap_doc_from_text(p_text text)
returns jsonb
language sql
immutable
as $$
  select case
    when p_text is null or p_text = '' then
      jsonb_build_object('type', 'doc', 'content', jsonb_build_array())
    else
      jsonb_build_object(
        'type', 'doc',
        'content', jsonb_build_array(
          jsonb_build_object(
            'type', 'paragraph',
            'content', jsonb_build_array(
              jsonb_build_object('type', 'text', 'text', p_text)
            )
          )
        )
      )
  end;
$$;

-- ---------------------------------------------------------------------
-- Extend the existing search_vector trigger (tasks_update_search_vector,
-- from 20260819064522_task_key_search_fts.sql) to also derive
-- description_json/description_text from the legacy description column
-- on every write, and to index description_text (rather than the legacy
-- description column) in the tsvector -- "Update the FTS trigger to
-- index description_text instead of the old column."
-- ---------------------------------------------------------------------
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

  -- Derive the rich-text JSON doc and its plain-text projection from the
  -- legacy plain-text column, since no writer produces description_json
  -- directly yet (see migration header comment). This keeps
  -- description_text (and therefore search) always in sync with
  -- whatever was actually written, with description as the single
  -- source of truth until a later feature flips the direction.
  new.description_json := public.tiptap_doc_from_text(new.description);
  new.description_text := coalesce(new.description, '');

  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(new.description_text, '')), 'B')
    || setweight(to_tsvector('simple', v_task_key), 'A');

  return new;
end;
$$;

-- Widen the trigger's column list so it also fires when description_json
-- is written directly (future-proofing for the later feature that wires
-- the editor into the write path), in addition to the existing columns.
drop trigger if exists tasks_search_vector_trigger on tasks;
create trigger tasks_search_vector_trigger
  before insert or update of title, description, description_json, number, project_id on tasks
  for each row
  execute function public.tasks_update_search_vector();

-- ---------------------------------------------------------------------
-- Backfill every existing row: description_text gets the raw existing
-- description text (empty string for null), description_json gets it
-- wrapped as a single-paragraph Tiptap document (or an empty doc for
-- null/empty description).
-- ---------------------------------------------------------------------
update tasks
set
  description_json = public.tiptap_doc_from_text(description),
  description_text = coalesce(description, '');
