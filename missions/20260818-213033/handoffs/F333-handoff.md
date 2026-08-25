# Handoff: F333 — Fix image attachment rows showing thumbnail + generic icon (M17 scrutiny BLOCKER-2)

## Status
COMPLETE

## Assertions covered
AS-505: PASS — `test_AS_505_an_image_attachment_renders_a_thumbnail_img_not_a_generic_icon` now also asserts the FileText icon (`data-testid="attachment-file-icon-<id>"`) is ABSENT on an image row, and `test_AS_505_a_non_image_attachment_still_shows_the_generic_file_icon_no_thumbnail` asserts it IS present on a non-image row. Both pass (`npx vitest run tests/unit/image-lightbox.test.tsx` — 7/7 passed).

## Files changed
components/task/attachment-list.tsx
tests/unit/image-lightbox.test.tsx

## Commands run
`npx vitest run tests/unit/image-lightbox.test.tsx` (0, 7 passed)
`npx tsc --noEmit` (0, no attachment-list/image-lightbox errors)
`npx eslint components/task/attachment-list.tsx tests/unit/image-lightbox.test.tsx` (0)
`npm run build` (attempted; failed on an UNRELATED pre-existing error in `lib/actions/attachments.ts` — `uploadAttachmentForUser` defined twice — see Out-of-scope below; this file was already dirty in the working tree before I started and I did not touch it)

## Decisions made
- Reused the exact same `attachment.mimeType?.startsWith("image/")` check the thumbnail's own condition already uses (no shared constant/helper existed for this — the codebase's other mime checks in this file follow the same inline-check convention, e.g. `imageAttachments` filter and `handleOpen`'s branch, so I matched that convention rather than introducing a new helper).
- Changed the thumbnail's `&&` render to a `? … : null` ternary purely for symmetry/readability with the new inverse condition on `<FileText>`; behavior unchanged.
- Added `data-testid={\`attachment-file-icon-${attachment.id}\`}` to the `<FileText>` icon so the negative assertion ("icon absent on image rows") is queryable — the codebase's existing convention elsewhere in this file already uses `data-testid` for test-only hooks (e.g. `image-lightbox` in ImageLightbox), so this matches rather than introducing a new pattern (aria-hidden icons aren't otherwise addressable by RTL's accessible queries).

## Out-of-scope work needed
`npm run build` currently fails with `Error: the name 'uploadAttachmentForUser' is defined multiple times` in `lib/actions/attachments.ts`. This is a pre-existing defect in the working tree, unrelated to F333/BLOCKER-2/AS-505, and outside this feature's "Touches" (attachment-list.tsx + its test only). I confirmed it predates my change: `lib/actions/attachments.ts` was already modified (not by me) before I started, per `git status` at the start of this session. The orchestrator should route this to whichever feature/worker owns `lib/actions/attachments.ts`'s current in-flight change (likely a duplicate-export merge conflict from parallel worker sessions touching the same repo) — it will block any `npm run build` check until fixed, independent of F333.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a `data-testid` on the FileText icon rather than an `aria-label`/role-based query, since the icon is `aria-hidden="true"` (decorative, correctly not exposed to the accessibility tree) and RTL's accessible-name queries can't target it — this is consistent with how `ImageLightbox`'s own root element (`data-testid="image-lightbox"`) is already queried in this same test file.

## Notes for the next worker
IMPORTANT — concurrency hazard encountered during this session: partway through, my uncommitted edits to `components/task/attachment-list.tsx` and `tests/unit/image-lightbox.test.tsx` were silently wiped (files reverted to match `git HEAD`, no diff, no stash) while other workers' commits (F265, F266, F267, M17-scrutiny doc) landed on `main` in the background. I had to re-apply both edits and commit immediately afterward to avoid losing the fix a second time. Future workers running late in a scrutiny-blocker cycle should commit fast after making an edit rather than doing a long verification pass first, since the shared working tree can be reset out from under an in-progress edit by concurrent activity on the same repo/branch.

No MCP tools used — this is a pure UI/unit-test fix with no external service touched.
