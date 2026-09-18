-- P2-34: Storage buckets without size/MIME limits.
--
-- `avatars` (20260818201642_create_avatars_bucket.sql) already declares
-- `file_size_limit`/`allowed_mime_types` at bucket-creation time. Three
-- other buckets never got the same treatment, so an authenticated caller
-- could upload an arbitrarily large file of any MIME type to them:
--   - task-attachments   (20260818050100_create_attachments.sql)
--   - chat-attachments   (20260904070000_chat_attachments.sql)
--   - scope-documents    (20261106010000_scope_documents.sql)
--
-- Limits mirror lib/validation/attachments.ts's
-- MAX_ATTACHMENT_SIZE_BYTES/ALLOWED_ATTACHMENT_MIME_TYPES exactly (the one
-- source of truth every one of these three upload paths already validates
-- against server-side — chat's lib/validation/chat-attachments.ts
-- re-exports the same two constants verbatim, and
-- lib/validation/project-scope-documents.ts's own header comment says its
-- file field reuses "the shared uploadAttachmentSchema shape"). This is
-- bucket-level defense in depth on top of that existing app-level check,
-- same relationship the avatars bucket's own header comment describes
-- between its limits and lib/validation/profile.ts's constants.
--
-- image/svg+xml is deliberately NOT included (ARCH-010: an uploaded SVG
-- opened from a signed Storage URL executes embedded script on the
-- Storage origin — lib/validation/attachments.ts's own comment records
-- the same reasoning for why it was removed from the app-level allowlist).

update storage.buckets
set
  file_size_limit = 4194304, -- 4MB, matches MAX_ATTACHMENT_SIZE_BYTES
  allowed_mime_types = array[
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
where name in ('task-attachments', 'chat-attachments', 'scope-documents');
