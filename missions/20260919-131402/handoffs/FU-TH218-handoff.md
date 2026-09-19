# Handoff: FU-TH218 — modified indicator on file row for non-Original active version

## Status
COMPLETE

## Assertions covered
TH-218: A file row in the code-editor file list shows a visual "modified" indicator when the active version for that block is not the Original version. PASS — verified via test_TH_218_row_shows_modified_indicator_when_active_version_not_original, test_TH_218_row_has_no_modified_indicator_when_active_version_is_original, and test_TH_218_modified_indicator_is_visually_distinct_from_dirty_indicator in tests/unit/th-file-list.test.tsx (all pass).

## Files changed
components/code-editor/file-list.tsx
components/code-editor/editor-layout.tsx
tests/unit/th-file-list.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npm run build` (0)
`npx vitest run tests/unit/th-file-list.test.tsx` (0) — 22 passed
`npx vitest run` (0, but with pre-existing failures) — 264 test files / 218 tests failed, all in `tests/integration/*` due to `TypeError: fetch failed` against a live Supabase project (no network access in this sandbox). None of the failures touch `components/code-editor/*` or the file-list/editor-layout tests, which are fully green. This is a pre-existing environment limitation, not caused by this change.

## Decisions made
- Added `isModified?: boolean` to `FileListEntry` (not a separate prop) to keep the existing per-row entry shape consistent with `isDirty`.
- Rendered the modified indicator as its own `•` span with `data-testid="modified-indicator-{index}"`, `text-blue-400`, positioned before the existing dirty indicator, so both can show simultaneously and are visually/DOM distinguishable (different testids and classNames).
- In `editor-layout.tsx`, extended `toFileListEntries` to take `versionsByBlock: Record<number, VersionEntry>` (the actual state shape already in the component — keyed by block index, `{ versions, activeVersionId }`) rather than the `versionsByBlock[block.id]` / `activeVersionIdByBlock[block.id]` shape sketched in the ticket, since that shape doesn't exist in this codebase. Used `versions.find(v => v.id === activeVersionId)` and `!activeVer.isOriginal` (the `Version` type in `lib/code-editor/versions.ts` already has `isOriginal: boolean`), matching the ticket's intent exactly.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the real `versionsByBlock`/`VersionEntry` (keyed by index) state already present in `editor-layout.tsx` instead of the `versionsByBlock[block.id]` / `activeVersionIdByBlock[block.id]` pseudo-code in the ticket, since the ticket's exact variable names don't exist in this file. The computed `isModified` semantics (active version present and not Original) are identical to what the ticket specified.

## Notes for the next worker
While staging this fix, `git add -A` on the two target file paths also picked up a pre-existing staged deletion of `tests/integration/f017-new-discipline-estimates.test.ts` from an unrelated prior session. That was restored in a follow-up commit (`chore: restore f017 integration test accidentally deleted from index`) to keep the TH-218 commit scoped. Also noticed several other unrelated modified/untracked files in the working tree (architecture components, playwright-mcp logs, other mission directories) that were left untouched and not committed.
