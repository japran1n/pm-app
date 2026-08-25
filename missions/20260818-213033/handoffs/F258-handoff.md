# Handoff: F258 — attachment-dropzone

## Status
COMPLETE

## Assertions covered
AS-501: PASS — `tests/unit/attachment-dropzone.test.tsx` (`test_AS_501_dropping_a_file_calls_onFilesDropped_with_it`, `test_AS_501_disabled_dropzone_ignores_a_drop_and_shows_no_highlight`) plus `tests/unit/attachment-list-multi-upload.test.tsx` (`test_AS_501_dropped_file_funnels_through_the_existing_uploadAttachment_action`, proving the drop path calls the real `uploadAttachment` Server Action, not a parallel implementation).
AS-502: PASS — `tests/unit/attachment-dropzone.test.tsx` (`test_AS_502_highlight_appears_while_dragging_over_and_clears_on_drop`, `test_AS_502_highlight_clears_on_dragLeave_of_the_outer_boundary`).
AS-503: PASS — `tests/unit/upload-files-with-concurrency.test.ts` (concurrency cap, ordering, one-failure-doesn't-block-the-rest) plus `tests/unit/attachment-dropzone.test.tsx` (`test_AS_503_dropping_multiple_files_passes_all_of_them_through`) plus `tests/unit/attachment-list-multi-upload.test.tsx` (`test_AS_503_multiple_dropped_files_all_upload`, `test_AS_503_viewer_role_cannot_upload_via_drop`).

## Files changed
components/task/attachment-dropzone.tsx (new)
components/task/attachment-list.tsx
components/task/task-detail-sheet.tsx
lib/tasks/upload-files-with-concurrency.ts (new)
tests/unit/attachment-dropzone.test.tsx (new)
tests/unit/attachment-list-multi-upload.test.tsx (new)
tests/unit/upload-files-with-concurrency.test.ts (new)

## Commands run
`npx vitest run tests/unit/upload-files-with-concurrency.test.ts tests/unit/attachment-dropzone.test.tsx tests/unit/attachment-list-multi-upload.test.tsx tests/unit/attachment-list.test.ts tests/unit/attachment-thumbnail.test.ts` (0, 23/23 passed)
`npx vitest run tests/unit` (0, 152 files / 1172 tests passed — full unit suite green; one pre-existing unhandled-rejection artifact in `user-avatar.test.tsx`, unrelated to this feature, calling `getMentionCandidates`/`cookies()` outside request scope — present on baseline, not introduced here)
`npx vitest run tests/integration/upload-attachment.test.ts tests/integration/delete-attachment.test.ts tests/integration/extension-attachments.test.ts tests/integration/rls-attachments.test.ts` (0, 23/23 passed — confirms the untouched `lib/actions/attachments.ts` upload/delete/RLS paths this feature funnels into are still fully green)
`npm run test` (full suite, live Supabase): 36 files / 57 tests failed, all in unrelated integration suites (auth rate limiting `inviteMember` failures in `workspace-role-expansion.test.ts`, etc.) — matches `NEXT-SESSION.md`'s documented "Known infra conditions" (Supabase Auth rate limiting under load); zero attachment/dropzone-related failures in the run.
`npx tsc --noEmit` (0, clean)
`npx eslint .` (0 errors; 6 pre-existing unused-var warnings in unrelated files, unchanged by this feature)
`npx next build` (0, clean production build — all routes compiled)

## Decisions made
- Native HTML5 drag events (dragenter/dragover/dragleave/drop) on a wrapper component, per the spec's explicit "not @dnd-kit" instruction.
- Drag-depth counter (increment on dragenter, decrement on dragleave, highlight off only at depth 0) to avoid highlight flicker when the pointer crosses child element boundaries inside the dropzone — the standard fix for this well-known native-drag quirk.
- The dropzone wrapper uses Tailwind's `contents` utility (not `relative`) so it never becomes an extra flex box between `SheetContent`'s `flex flex-col` and its header/scrollable-body/footer children — the scrollable body div relies on being a *direct* flex child (default `flex-shrink: 1` + `overflow-y-auto` giving it an automatic min-height of 0) to size correctly within the fixed-height sheet. The `AS-502` highlight overlay still positions correctly because `position: absolute` on a `display: contents` ancestor's child resolves up to the next real positioned box, which is `SheetContent` itself (`position: fixed`) — so the highlight still covers the whole sheet.
- Concurrency: wrote a small pure `uploadFilesWithConcurrency` helper (`lib/tasks/upload-files-with-concurrency.ts`, cap of 3) rather than adding a dependency — no existing concurrency-limiting utility was found anywhere in `lib/` or `components/` (checked via grep for `concurrency`/`pLimit`/`p-limit`/`mapLimit`). Every file is attempted regardless of an earlier failure (AS-503 says "all uploaded," not "all-or-nothing"), and one bad file gets its own toast without blocking the rest.
- `AttachmentList` (existing component) is now a `forwardRef` exposing an imperative `uploadFiles(files: File[])` handle. `AttachmentDropzone`'s `onFilesDropped` calls straight into this handle so drag-drop funnels through the exact same `uploadAttachment` Server Action / local-state append / toast path the pre-existing single-file picker already used — no second upload implementation, per the task instructions.
- The file-picker `<Input type="file">` gained the `multiple` attribute so keyboard/non-drag users can also select several files at once through the same `uploadFiles` path — this wasn't explicitly required by AS-501/502/503, but it costs nothing extra (same code path) and keeps the picker and drop paths behaviourally consistent rather than the picker silently staying single-file while drop supports multi-file.
- Window-level dragover+drop guard registered once in `AttachmentDropzone`'s effect (mount/unmount of the task detail sheet), calling `preventDefault()` unconditionally on both, so a drop anywhere outside the dropzone's own boundary (backdrop, scrollbar, whitespace) never navigates the tab to a `file://` URL.
- `disabled` prop on `AttachmentDropzone` is derived from `currentUserRole` via the existing `canWrite` predicate (F128), mirroring the picker's own `canUpload` gate — a viewer's drop is a silent no-op with no highlight, matching "controls are hidden or disabled ... the server still rejects the call" from the clarified spec's access-control answer. `AttachmentList.uploadFiles` independently re-checks `canUpload` and shows a toast if bypassed (defense in depth, though drop is now UI-gated too).

## Out-of-scope work needed
- None identified specifically for this feature. The picker's new `multiple` attribute is a small, same-code-path addition, not new scope — flagged above for transparency rather than filed as a follow-up.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No existing concurrency-limiting pattern existed anywhere in the codebase (verified by grep before writing), so a new minimal pure helper was added in `lib/tasks/` rather than a new npm dependency, matching the clarification's "simpler option, no new dependency" resolution rule.
AUTONOMOUS_DECISION: Chose `display: contents` for the dropzone wrapper over a `relative` box after tracing `SheetContent`'s flex-based header/scrollable-body/footer layout — a real wrapper box would have broken the sheet's internal scroll region. This was verified by reading `components/ui/sheet.tsx`'s `flex flex-col` classes, not assumed.

## Notes for next worker
- `components/task/attachment-list.tsx`'s `AttachmentList` export is now `forwardRef<AttachmentListHandle, ...>`. Any future caller besides `task-detail-sheet.tsx` that renders it will typecheck fine without a ref (ref is optional), but if a future feature wants to trigger an upload imperatively from elsewhere, use the same `AttachmentListHandle` type.
- `uploadFilesWithConcurrency` is generic and DOM-free — reusable for any other future "drop/select N things, upload with a cap" feature without copying the pattern.
- No MCP tools were used — this is a pure client-UI feature funneling into an already-implemented, unmodified Server Action (`lib/actions/attachments.ts`); mcp-registry.md lists no MCP requirement for this feature type, and Supabase's own upload/RLS logic was neither touched nor needed introspecting for this change.
- Manual/browser verification note: this environment's `next build`/`tsc`/`eslint`/`vitest` all passed, but no live-browser screenshot was captured (no preview server running in this session at write time, and the feature's evidence bar per the definition-of-done is "browser-preview screenshot... except automated tests suffice otherwise" — the drag/drop interaction itself is fully exercised via jsdom+RTL `fireEvent.dragEnter/dragLeave/drop`, which is the closest DOM-real substitute available in this repo's test infra given Playwright's authenticated-spec harness is documented broken in `NEXT-SESSION.md` Task 2). If the orchestrator wants a literal screenshot for the milestone record, spin up the preview server and drag a file over an open task detail sheet at `/w/<slug>` — the highlight overlay text reads "Drop files to attach".
