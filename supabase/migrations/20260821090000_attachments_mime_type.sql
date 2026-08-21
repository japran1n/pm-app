-- Follow-up to F066/F294 (user-reported issue, 2026-08-21): image
-- attachments (screenshots especially, uploaded via the QA feedback
-- extension or the web app) render as a plain filename link instead of an
-- inline thumbnail in the task detail view, because the `attachments`
-- table never persisted the file's MIME type even though
-- uploadAttachmentForUser (lib/actions/attachments.ts) already validates it
-- and passes it to Storage's `contentType` at upload time.
--
-- Adds a nullable `mime_type` column. Nullable (not not-null) because
-- existing rows predate this column and have no way to retroactively know
-- their MIME type without re-inspecting Storage objects out of band — the
-- UI (components/task/attachment-list.tsx) treats a NULL/non-image
-- mime_type identically: no thumbnail, falls back to the existing
-- filename-link rendering. No backfill is attempted for the same reason.
alter table attachments
  add column if not exists mime_type text;
