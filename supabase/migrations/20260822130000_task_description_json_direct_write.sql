-- F173 (AS-311): allow `tasks.description_json` to be written directly,
-- as flagged as required follow-up in
-- 20260822090000_task_description_json.sql's header comment ("Once a
-- later feature wires the rich-text editor into the write path and
-- starts writing description_json directly, this trigger's derivation
-- must be flipped").
--
-- Until now, tasks_update_search_vector() unconditionally overwrote
-- `new.description_json` FROM `new.description` on every insert/update
-- (deriving the rich-text doc from the legacy plain-text column) — so any
-- direct write to description_json (e.g. F173's inline checkbox toggle,
-- which updates ONLY description_json, never description) was silently
-- discarded by this trigger on the very next write.
--
-- This migration makes the derivation direction conditional:
--   - INSERT: if the caller supplied a non-null description_json
--     directly, keep it and derive description_text FROM it. Otherwise
--     (the existing createTask path, which only ever sets `description`),
--     keep deriving description_json/description_text FROM description,
--     exactly as before.
--   - UPDATE: if description_json actually changed AND description did
--     NOT change (i.e. this write only touched description_json — F173's
--     toggle action's signature), keep the caller's description_json and
--     derive description_text FROM it. Any other combination (the
--     existing editTask path, which only ever sets `description`) keeps
--     deriving FROM description, exactly as before — so no existing
--     writer's behaviour changes.
--
-- `description` itself is never derived FROM description_json here (out
-- of scope for F173 — the plain Textarea in task-detail-sheet.tsx is
-- still the only description-editing UI; wiring the full RichTextEditor
-- into that write path, and therefore needing description to track
-- description_json instead of the reverse, is a separate feature. Flagged
-- in this feature's handoff as Out-of-scope work needed.).

create or replace function public.tiptap_text_from_doc(p_doc jsonb)
returns text
language sql
immutable
as $$
  -- Recursively collects every node's `text` leaf value via the SQL/JSON
  -- path `$.**.text` (recursive descent, PostgreSQL 12+) and joins them
  -- with a space. Used only to build the FTS projection
  -- (tasks.description_text) -- never rendered to users -- so approximate
  -- word-boundary joining is an acceptable, documented simplification.
  select coalesce(
    string_agg(value #>> '{}', ' '),
    ''
  )
  from jsonb_path_query(coalesce(p_doc, '{}'::jsonb), '$.**.text') as t(value)
  where jsonb_typeof(value) = 'string';
$$;

create or replace function public.tasks_update_search_vector()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_key text;
  v_task_key text;
  v_direct_json_write boolean := false;
begin
  select key into v_project_key from projects where id = new.project_id;

  if v_project_key is not null and new.number is not null and new.number > 0 then
    v_task_key := v_project_key || '-' || new.number::text;
  else
    v_task_key := '';
  end if;

  if tg_op = 'UPDATE' then
    v_direct_json_write :=
      new.description_json is distinct from old.description_json
      and new.description is not distinct from old.description;
  elsif tg_op = 'INSERT' then
    v_direct_json_write := new.description_json is not null;
  end if;

  if v_direct_json_write then
    -- F173 (AS-311): a write that supplied description_json directly
    -- (the toggle action, or a caller inserting a rich document up
    -- front) -- keep it as the source of truth and derive the plain-text
    -- projection FROM it instead of overwriting it.
    new.description_text := public.tiptap_text_from_doc(new.description_json);
  else
    -- Existing behaviour (F170): derive the rich-text JSON doc and its
    -- plain-text projection from the legacy plain-text column, since this
    -- write only touched `description` (editTask's/createTask's only
    -- write path).
    new.description_json := public.tiptap_doc_from_text(new.description);
    new.description_text := coalesce(new.description, '');
  end if;

  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(new.description_text, '')), 'B')
    || setweight(to_tsvector('simple', v_task_key), 'A');

  return new;
end;
$$;
