# Handoff: F066 — attachment list render

## Status
COMPLETE

## Assertions covered
AS-109: PASS — `AttachmentList` renders each attachment's file name and resolves the uploader label from the `members` prop (name → email → user id fallback). Covered by `tests/unit/attachment-list.test.ts` (`test_AS_109_*`).
AS-115: PASS — a successful `uploadAttachment` call appends the returned attachment to local state via the pure `appendAttachment` reducer, with no re-fetch/reload. Covered by `tests/unit/attachment-list.test.ts` (`test_AS_115_*`), which exercises the same reducer the component's upload handler calls.

## Files changed
components/task/attachment-list.tsx
lib/tasks/append-attachment.ts
tests/unit/attachment-list.test.ts
components/task/task-detail-sheet.tsx

## Commands run
`npx vitest run tests/unit/attachment-list.test.ts tests/unit/comment-list.test.ts` (0)
`npx tsc --noEmit` (0)
`npx eslint components/task/attachment-list.tsx components/task/task-detail-sheet.tsx lib/tasks/append-attachment.ts tests/unit/attachment-list.test.ts` (0)
`npx vitest run` (0 relevant; 2 pre-existing unrelated integration test timeouts — `tests/integration/change-member-role.test.ts` AS-014 and `tests/integration/remove-member.test.ts` AS-016, both network-bound Supabase integration tests unrelated to F065/F066, failing before this change too)
`npm run build` (0)

## Decisions made
- Kept `AttachmentList` a Client Component composed directly inside `task-detail-sheet.tsx` (also a Client Component), deviating from the clarified spec's default "Server Component fetch + thin client boundary" — this is the exact same, already-established deviation `components/task/comment-list.tsx` (F060) and `components/task/tags-editor.tsx` (F041) document: splitting out a Server Component wrapper here would force either a second network round trip from a Client parent or prop-drilling a fetched list anyway. Matches the instruction in this feature's assignment ("create components/task/attachment-list.tsx (Client Component)") and the existing sibling-component convention.
- No `lib/queries/attachments.ts` exists yet (only F064's migration + F065's actions). Mirrored `TaskDetailSheet`'s `comments` prop convention: added an optional `attachments` prop (default `[]`) so a caller that hasn't been updated to fetch attachments yet still renders a valid empty state. Fetching the initial attachments list server-side is out of scope for this feature (see Out-of-scope below).
- Extracted the "append a new attachment to local state" logic into a pure `appendAttachment` reducer (`lib/tasks/append-attachment.ts`), mirroring `lib/tasks/reconcile-realtime-comment.ts`'s convention, specifically so AS-115 is unit-testable without a DOM — this repo's vitest environment is `"node"` (see `vitest.config.ts`), so there is no jsdom/file-input simulation available to drive the component's actual `<input type="file">` change handler in a unit test. The reducer is idempotent by `id`, and the component's upload success handler calls it directly, so the test exercises the exact function the component runs.
- Signed URLs: used the upload's own returned `signedUrl` implicitly nowhere in stored state (only the raw `fileUrl`/object path is kept in `TaskAttachment`, matching `uploadAttachment`'s return shape's non-signed fields) — every "Open" click calls `getAttachmentSignedUrl(attachmentId)` fresh, per AS-108's "generate on demand, don't cache a stale one" instruction from the task description, rather than storing/reusing the upload response's one-time signed URL for later clicks.
- Upload control: a plain `<input type="file">` (shadcn `Input`) wired to `uploadAttachment` via `FormData`, matching `lib/actions/attachments.ts`'s documented calling convention (`taskId` + `file` fields). Kept as a single file-select-triggers-upload flow (no separate "Upload" button) for the smallest interactive surface, consistent with this milestone's other single-action controls (e.g. priority/assignee selects in `TaskDetailSheet`).

## Out-of-scope work needed
- No `lib/queries/attachments.ts` (`getTaskAttachments`) exists yet to fetch a task's initial attachment list server-side and pass it into `TaskDetailSheet`'s new `attachments` prop — currently defaults to `[]` wherever `TaskDetailSheet` is rendered. A future feature (parallel to how `lib/queries/comments.ts` backs F060's `comments` prop) should add this query and wire it into whatever Server Component page renders `TaskDetailSheet`.
- No delete-attachment action/UI exists (out of this feature's assigned assertions, AS-109/AS-115 only — delete is a separate AS range if/when planned).
- No realtime attachment sync (parallel to F062/F063's `useCommentsRealtime`) — a concurrently-open second viewer will not see another viewer's upload without a reload. Not required by AS-109/AS-115, which only cover the acting viewer's own upload appearing immediately.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Added an `attachments` prop to `TaskDetailSheet` defaulting to `[]`, since no query/caller currently supplies it — chosen to match the exact same optional-prop-with-empty-default pattern already used for `comments` on the same component, rather than inventing a new convention.
AUTONOMOUS_DECISION: Chose "select a file in the input triggers upload immediately" over a separate Choose File + Upload button pair, since `lib/actions/attachments.ts` has no separate "prepare" step and the simpler one-step flow needs less client state.

## Notes for the next worker
- `AttachmentList` and `appendAttachment` follow `CommentList` / `reconcileComment`'s established naming and structure closely — read those two files first if extending this one (e.g. adding delete or realtime sync), the conventions carry over directly.
- Uploader/author display resolution (`uploaderLabel`) intentionally duplicates `CommentList`'s `authorLabel` rather than sharing a helper — same duplication already exists between `CommentList` and `TaskDetailSheet`'s own `memberLabel`, so this doesn't introduce a new inconsistency.
- MCP: none used (Notes/registry says none for this feature).
