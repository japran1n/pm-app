# Handoff: F067 — delete attachment action

## Status
COMPLETE

## Assertions covered
AS-110: PASS — `deleteAttachment` allows the attachment's own uploader (`uploaded_by === user.id`) or a workspace admin/owner to delete it. Covered by `tests/integration/delete-attachment.test.ts` (uploader-delete test, admin-delete-another-member's-attachment test).
AS-111: PASS — a different regular member (not uploader, not admin/owner) is rejected server-side; row and storage object are left untouched. Covered by `tests/integration/delete-attachment.test.ts`.
AS-114: PASS — successful deletion removes both the `attachments` row and the Storage object; verified directly against Storage (`storage.list`) in the same test, not just the DB row. Ordering (storage-first, then row) documented in `lib/actions/attachments.ts`'s `deleteAttachment` doc comment so a failure degrades to a detectable dangling row reference rather than a silent, unbounded orphaned Storage object.

## Files changed
lib/actions/attachments.ts
lib/validation/attachments.ts
components/task/attachment-list.tsx
components/task/task-detail-sheet.tsx
tests/integration/delete-attachment.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/actions/attachments.ts lib/validation/attachments.ts components/task/attachment-list.tsx components/task/task-detail-sheet.tsx tests/integration/delete-attachment.test.ts` (0)
`npx vitest run tests/integration/delete-attachment.test.ts` (0 — 5/5 passed)
`npx vitest run tests/unit` (0 — 143/143 passed)
`npm run build` (0)
`npm test` (0 — full vitest suite, 367/367 passed, includes all integration tests)
`npm run lint` (0)

## Decisions made
- **Deletion ordering (AS-114):** delete the Storage object first, then the `attachments` row, and abort (returning an error, row untouched) if the Storage delete fails. Rationale documented at length in the function's doc comment in `lib/actions/attachments.ts`: this table's row is the *only* reference to its Storage object (confirmed in F064's migration comment — no other table points at `file_url`), so row-first deletion risks leaving a Storage object with zero rows referencing it ever again — an untraceable, permanently-silent orphan, which is exactly what AS-114 prohibits. Storage-first instead fails in a way that stays *visible*: if the row delete then fails, the row still exists but points at a now-missing object (a dangling reference that 404s loudly on next access, not a silent accumulation), and this specific failure path is also `console.error`-logged so it's never silent even in its worst case.
- **Hard delete, not soft delete:** unlike `deleteComment` (soft-delete via `deleted_at`), `attachments` has no `deleted_at` column — F064's migration comment explicitly states "F067 will hard-delete both the attachments row and the Storage object together." Used `.delete()` not `.update({deleted_at})`.
- **Authorization pattern:** copied `deleteComment`'s author-or-admin structure directly — `uploaded_by === user.id` branch re-verifies active membership (defense in depth for a removed member), else `requireWorkspaceAdmin` gates the non-uploader path. Same generic user-facing error message on any rejection, matching AS-146's "no raw DB errors surfaced" convention used throughout this codebase.
- **UI wiring:** added `currentUserId`/`currentUserRole` props to `AttachmentList` and a delete icon-button per attachment, gated by a `canDelete()` helper — copied verbatim from `CommentList`'s `canDelete`/delete-button pattern (F061), including the "undefined `currentUserId` hides delete everywhere" UX-only convention (the server action is the real enforcement boundary, per the same comment `CommentList` carries). Wired `task-detail-sheet.tsx`'s existing `currentUserId`/`currentUserRole` props (already passed to `CommentList`) through to `AttachmentList` too — no new props needed on `TaskDetailSheet` itself.
- **Test seeding:** `tests/integration/delete-attachment.test.ts` seeds a *real* Storage object (not just a DB row with an arbitrary `file_url`) so AS-114 can be verified against actual Storage state (`storage.list()`) rather than only the DB row's absence — a DB-only check would not have caught a bug that deleted the row but left the file behind.

## Out-of-scope work needed
- None identified specific to attachments. (Search — F068-F070 — is the only remaining M6 sub-feature; not attachments-related.)

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose storage-first-then-row deletion ordering (see "Decisions made" above) since the spec text offered both orderings as options and asked the worker to pick one and document the reasoning.
AUTONOMOUS_DECISION: Did not filter on `taskRow.deleted_at` in `deleteAttachment` (unlike `getAttachmentSignedUrl`, which treats a soft-deleted task's attachments as not-found for viewing). Deleting an attachment belonging to an already soft-deleted task is harmless cleanup, not a security-relevant read, so left it permitted rather than adding an extra restriction not asked for by AS-110/AS-111/AS-114.

## Notes for the next worker
- Attachments (F064-F067) are now fully complete: schema + private Storage bucket + RLS (F064), upload (F065), list/render (F066), delete (F067 — this handoff). All AS-105 through AS-115 assertions covered.
- Search (F068-F070) is the last M6 sub-feature remaining.
- `deleteAttachment` follows `deleteComment`'s structure closely — read `lib/actions/comments.ts` first if extending further (e.g. adding realtime sync for cross-viewer attachment removal, which does not exist yet, same gap F066's handoff already noted for uploads).
- MCP: none used (registry says none for this feature, consistent with F064-F066).
