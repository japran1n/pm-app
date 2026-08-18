# Handoff: F065 — upload attachment action

## Status
COMPLETE

## Assertions covered
AS-105: PASS — `uploadAttachment` re-verifies the caller is an active member of the task's real (server-looked-up) workspace before uploading; integration test asserts a member succeeds and a non-member is rejected with no row/object created.
AS-108: PASS — `uploadAttachment` returns `signedUrl` from `storage.createSignedUrl(objectPath, 3600)` (1 hour), never a public URL; `attachments.file_url` stores only the private object path. Added a second helper, `getAttachmentSignedUrl(attachmentId)`, so any future display surface (attachment list, etc.) can mint a fresh signed URL instead of persisting/reusing one — test asserts the returned URL contains a `token=` query param.
AS-112: PASS — `uploadAttachmentSchema` (Zod) rejects `fileSize > MAX_ATTACHMENT_SIZE_BYTES` (10MB) before any Storage call; integration test uploads an 11MB file and asserts rejection with no row created.
AS-113: PASS — `uploadAttachmentSchema` rejects any MIME type not in `ALLOWED_ATTACHMENT_MIME_TYPES` (closed allowlist: images, PDF, text/csv, legacy+OOXML Office formats) before any Storage call; integration test uploads a `application/x-sh` file and asserts rejection with no row created.

## Files changed
lib/actions/attachments.ts
lib/validation/attachments.ts
tests/integration/upload-attachment.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run tests/integration/upload-attachment.test.ts` (0 — 4/4 passed)
`npm test` (0 — 356/356 passed, full suite)
`npm run build` (0)

## Decisions made
- Size limit: 10MB (`MAX_ATTACHMENT_SIZE_BYTES` in `lib/validation/attachments.ts`). No value was specified in tech-decisions.md or the clarified spec for this feature, so I picked a reasonable v1-scale default and documented the rationale inline (large enough for the allowed file types, small enough to stay under typical request body limits).
- MIME allowlist: images (png/jpeg/gif/webp/svg), PDF, text/plain, text/csv, and Office legacy + OOXML formats (doc/docx/xls/xlsx/ppt/pptx) — documented as a closed allowlist in `lib/validation/attachments.ts` so unanticipated types are rejected by default.
- `uploadAttachment(formData: FormData)` signature, not `(taskId, file)` — Server Actions receive `File` objects only through `FormData`; caller is expected to build `FormData` with `taskId` and `file` fields.
- Storage path: `{taskId}/{timestamp}-{random}-{sanitized-filename}` — first segment is the task UUID (F064's required convention for the bucket's INSERT RLS policy), remainder made collision-safe with a random suffix while keeping the original name legible; `attachments.file_name` stores the *original* unsanitized name for display, `attachments.file_url` stores the actual sanitized object path.
- Signed URL TTL: 1 hour (`SIGNED_URL_TTL_SECONDS`), applied both at upload time (immediate display) and in the new `getAttachmentSignedUrl` helper (for later display, e.g. F069's attachment list UI).
- If the DB insert fails after a successful Storage upload, the action best-effort deletes the just-uploaded Storage object (`admin.storage.from(...).remove(...)`) so a failed request doesn't leave an orphan behind — same spirit as AS-114 even though that assertion is F067's scope, not this one's.
- Reused `requireActiveMembership` from `lib/auth/require-membership.ts` (no new helper needed) and the admin-client-does-the-write-after-app-level-check pattern from `lib/actions/comments.ts`, for consistency with the rest of the codebase.
- Added `getAttachmentSignedUrl` beyond the strict "upload" scope of this feature, because AS-108 explicitly says *any* place attachments are displayed must mint a fresh signed URL — a bare `uploadAttachment` alone would leave no supported way for a later feature (attachment list, F069/F109 area) to re-fetch a valid link once the upload-time one expires, without either duplicating this logic or reaching straight into Storage from outside `lib/actions`. Kept minimal: takes an attachment id, re-checks membership, returns a signed URL or a generic error.

## Out-of-scope work needed
- AS-109 (task shows list of attachments with file name/uploader) and AS-115 (list updates immediately without reload) are UI-layer work, not covered here — a future feature will need a component that calls `uploadAttachment`/`getAttachmentSignedUrl` and subscribes to Realtime on `attachments` (mirroring the comments-list pattern) for the no-reload requirement.
- AS-110/AS-111 (delete by uploader/admin) and AS-114 (delete cascade to Storage) are explicitly F067's scope per F064's handoff — not touched here.
- No Supabase Storage bucket-level file-size-limit setting was configured (F064's handoff flagged this as an F065 concern); enforcement here is purely at the Zod-validation layer before any Storage call, which satisfies AS-112's "rejected ... before the upload completes" wording. If a defense-in-depth bucket-level limit is later wanted, that's a Storage config change, not an app-code change.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose 10MB as the file size limit and the specific MIME allowlist (images/PDF/text/Office docs) since neither was pinned by tech-decisions.md or the clarified spec — documented both choices and their rationale directly in `lib/validation/attachments.ts` so a later feature/validator can see and, if needed, revise the exact list/limit without re-deriving it from scratch.
AUTONOMOUS_DECISION: Added `getAttachmentSignedUrl` as a second exported action beyond the spec's named `uploadAttachment`, strictly to satisfy AS-108's "any place attachments are displayed must generate a signed URL" requirement for future consumers — did not build any UI or wire it up anywhere, so it stays within "files changed: lib/actions/attachments.ts" scope rather than expanding into a new feature area.

## Notes for the next worker
- Bucket name (from F064): `task-attachments`. Path convention: `{task_id}/{filename}` — first segment must be the task UUID or the Storage INSERT RLS policy rejects the write. This worker's actual stored object name is `{task_id}/{timestamp}-{random}-{sanitized-original-name}`, still satisfying that first-segment rule.
- `attachments.file_url` holds the Storage object path, not a URL of any kind — always call `.storage.from("task-attachments").createSignedUrl(file_url, ttl)` to get something clickable. Never expose `file_url` directly to the client as a link.
- Test file `tests/integration/upload-attachment.test.ts` follows the same `loadDotEnv`/`describe.skipIf(!haveAdminCreds)`/mocked-`@/lib/supabase/server` pattern as `tests/integration/add-comment.test.ts`; creates real throwaway workspace/user/project/task rows via the admin client, cleans up (including Storage objects) in `afterAll`.
- No Supabase MCP tools were used in this session — verification was via `npx tsc`, `npm run lint`, `npx vitest run`, `npm test`, and `npm run build` only, plus the integration test hitting the real linked Supabase project.
