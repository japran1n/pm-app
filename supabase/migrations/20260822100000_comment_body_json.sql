-- F174 (AS-312): rich-text storage for comments.
--
-- Additive, non-destructive migration (this mission's "additive first"
-- convention — see F170's 20260822090000_task_description_json.sql for
-- the identical pattern applied to tasks.description).
--
-- New columns:
--   comments.body_json  jsonb  — Tiptap JSONContent document (F169's
--                                RichTextEditor/RichTextRenderer storage
--                                format). Backfilled from the legacy
--                                `text` column below; going forward,
--                                lib/actions/comments.ts's addComment
--                                writes this directly from the shared
--                                editor's real output (unlike F170's
--                                tasks.description_json, which still had
--                                to derive from plain text via a trigger
--                                because no UI produced real Tiptap JSON
--                                yet at that point in the mission — this
--                                feature DOES wire the editor into the
--                                write path, so no derive-by-trigger is
--                                needed here).
--   comments.body_text  text   — plain-text projection of body_json, kept
--                                in sync by the Server Action on every
--                                insert (not a trigger, since the action
--                                already computes this to satisfy the
--                                legacy `text` column/CHECK constraint).
--
-- Legacy `comments.text` column is kept, populated, and marked deprecated
-- (additive; drop happens only in a future dedicated cleanup feature, per
-- this mission's F270 precedent) — comments_text_not_empty still enforces
-- non-empty `text` at the DB layer, so the Server Action keeps writing it
-- in lockstep with body_text rather than leaving it to drift.

alter table comments
  add column if not exists body_json jsonb;

alter table comments
  add column if not exists body_text text;

-- One-time backfill for every existing comment: wrap its legacy `text`
-- into the same single-paragraph Tiptap doc shape F170's
-- tiptap_doc_from_text() already defines (reused here, not redefined, so
-- there is exactly one place this shape is produced across the whole
-- app).
update comments
set
  body_json = coalesce(body_json, public.tiptap_doc_from_text(text)),
  body_text = coalesce(body_text, text)
where body_json is null
   or body_text is null;

comment on column comments.text is
  'DEPRECATED (F174): superseded by body_json (Tiptap JSONContent rich-text document) and body_text (plain-text projection). Kept populated (and required by comments_text_not_empty) for backward compatibility until a future cleanup feature removes it. Do not add new readers of this column.';

comment on column comments.body_json is
  'F174: Tiptap JSONContent rich-text document for this comment. Rendered read-only via components/editor/rich-text-editor.tsx''s RichTextRenderer, which re-sanitises on every render regardless of what is stored here (defense in depth, see that file''s sanitiseDocument doc comment) — this column is never rendered as raw HTML.';

comment on column comments.body_text is
  'F174: plain-text projection of body_json, written by lib/actions/comments.ts on every insert. Not currently indexed for search (comments have no full-text search feature yet); exists as the plain-text source of truth alongside the legacy text column.';
