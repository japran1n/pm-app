-- F205 (AS-378): fixes a data-loss gap in
-- 20260822130000_task_description_json_direct_write.sql's UPDATE branch,
-- surfaced by wiring the full RichTextEditor into the description WRITE
-- path (this feature) rather than only F173's narrow single-purpose
-- checkbox-toggle action.
--
-- The previous UPDATE rule was: "if description_json changed AND
-- description did NOT change, keep description_json; otherwise derive
-- description_json FROM description". That was correct as long as every
-- non-toggle writer (editTask) touched ONLY `description` on every call.
-- F205 breaks that assumption: editTask now sometimes writes
-- `descriptionJson` alone (the new RichTextEditor's save path) and, on a
-- LATER, unrelated call, writes some other field entirely (e.g. `title`)
-- while touching NEITHER `description` NOR `description_json`. Under the
-- previous rule, that later call still fell into the "derive FROM
-- description" branch (since description_json wasn't distinct from the
-- old row's value on an untouched column) -- silently re-deriving
-- description_json from the STALE legacy `description` column and
-- DISCARDING whatever rich content (and any mentions in it) the editor
-- had just saved.
--
-- New three-way rule, still derived purely from what actually changed on
-- THIS write (no new columns, no backfill needed -- pure function logic
-- change, consistent with this same function already having been
-- `create or replace`d once before by the prior migration):
--   1. `description` changed on this write -> derive description_json AND
--      description_text FROM description (the legacy Textarea path,
--      unchanged from before).
--   2. `description` did NOT change but `description_json` DID -> keep
--      the caller's description_json, derive description_text FROM it
--      (F173's toggle action's shape, and now F205's RichTextEditor save
--      path too).
--   3. NEITHER changed (e.g. editTask writing only `title`/`priority`/
--      etc.) -> leave description_json/description_text COMPLETELY
--      untouched. This is the fix: previously this case wrongly fell into
--      branch 1 and clobbered the stored rich document.
-- INSERT keeps its existing two-way rule (F170), unchanged.

create or replace function public.tasks_update_search_vector()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_key text;
  v_task_key text;
  v_description_changed boolean := false;
  v_description_json_changed boolean := false;
begin
  select key into v_project_key from projects where id = new.project_id;

  if v_project_key is not null and new.number is not null and new.number > 0 then
    v_task_key := v_project_key || '-' || new.number::text;
  else
    v_task_key := '';
  end if;

  if tg_op = 'UPDATE' then
    v_description_changed := new.description is distinct from old.description;
    v_description_json_changed :=
      new.description_json is distinct from old.description_json;

    if v_description_changed then
      -- Branch 1 (F170): the legacy plain-text column was written this
      -- call -- derive the rich doc + FTS projection FROM it, exactly as
      -- before.
      new.description_json := public.tiptap_doc_from_text(new.description);
      new.description_text := coalesce(new.description, '');
    elsif v_description_json_changed then
      -- Branch 2 (F173/F205): a direct description_json write, with
      -- description untouched -- keep it as the source of truth, derive
      -- description_text FROM it.
      new.description_text := public.tiptap_text_from_doc(new.description_json);
    end if;
    -- Branch 3 (F205 fix): neither changed -- new.description_json and
    -- new.description_text already equal the old row's values (untouched
    -- columns carry their existing value into `new` on a partial UPDATE),
    -- so there is deliberately nothing to do here.
  elsif tg_op = 'INSERT' then
    if new.description_json is not null then
      new.description_text := public.tiptap_text_from_doc(new.description_json);
    else
      new.description_json := public.tiptap_doc_from_text(new.description);
      new.description_text := coalesce(new.description, '');
    end if;
  end if;

  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(new.description_text, '')), 'B')
    || setweight(to_tsvector('simple', v_task_key), 'A');

  return new;
end;
$$;
