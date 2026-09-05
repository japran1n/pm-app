# Handoff: F005 — Optimistic title save in task detail sheet

## Status
COMPLETE

## Assertions covered
AS-009: PASS — `test_AS_009_pending_indicator_appears_while_the_title_save_is_in_flight` proves a spinner (`data-testid="title-saving-indicator"`) appears once `editTask` is called and before it resolves, and disappears once it resolves.
AS-010: PASS — `test_AS_010_title_reverts_to_its_pre_edit_value_and_shows_an_error_toast_on_server_failure` proves the input value reverts to "Original title" and `toast.error("Server rejected the title.")` fires when `editTask` resolves `{ ok: false }`.
AS-011: PASS — `test_AS_011_enter_commits_the_title_edit_inline_without_a_dialog` and `test_AS_011_escape_cancels_the_edit_and_reverts_without_saving` prove Enter commits inline (calls `editTask` directly, no dialog) and Escape cancels without ever calling `editTask`.

## Files changed
components/task/task-detail-sheet.tsx
tests/unit/f005-task-detail-sheet-title-optimistic.test.tsx

## Commands run
`npx vitest run tests/unit/f005-task-detail-sheet-title-optimistic.test.tsx` (0, 4/4 passing)
`npx tsc --noEmit` (0)
`npm run lint` (0, pre-existing warnings only, no errors, none in changed files)
`npm test` (background run of full suite) — 307/377 test files passed, 70 failed. All 70 failures are pre-existing `tests/integration/*` files that hit the LIVE Supabase project and fail with `Request rate limit reached` / RLS assertion mismatches unrelated to this change (e.g. `trash-view.test.ts`, `workspace-members-list.test.ts`, `task-assignees-multi.test.ts`). None of the failures reference `task-detail-sheet` or this feature's test file — the new F005 test file and every other unit test in `tests/unit/` passed. This is an environmental/rate-limit issue with the shared Supabase project, not a regression introduced here.

## Decisions made
- Gave the title its own `useTransition` (`isSavingTitle`/`startTitleSaveTransition`), separate from the Sheet's existing shared `isSavingField` transition (used by status/priority/due-date/description), so AS-009's pending indicator reflects the title save specifically rather than lighting up for unrelated field saves — matches this file's existing convention of per-control transitions (`isAssigning`, `isDeleting`).
- Added a synchronous `isCancellingTitleEditRef` guard: Escape reverts `title` state and then calls `element.blur()` synchronously in the same handler, but the resulting `blur` event fires before React has applied the `setTitle` update, so `handleTitleBlur` would otherwise read the stale (about-to-be-discarded) value and save it. The ref-guarded early-return in `handleTitleBlur` prevents that — verified by `test_AS_011_escape_cancels_the_edit_and_reverts_without_saving`, which failed before the fix (editTask was called with the discarded text) and passes after.
- Added 500-char validation (`maxLength` on the input + a blur-time length check that reverts and toasts) per the clarified spec's "1–500 chars, trimmed" answer — the existing empty-title check already covered the 1-char minimum.
- `stopPropagation()` on the Escape keydown so F247's global escape-layer stack (`useEscapeLayer`) doesn't also treat the same keystroke as "close the whole Sheet."

## Out-of-scope work needed
None identified specific to this feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a dedicated `useTransition` for the title rather than reusing the shared `isSavingField` transition already wired to other fields' saves, since AS-009 specifically requires a visual indicator tied to the title mutation — reusing the shared flag would have made the spinner appear during unrelated saves (e.g. changing due date) too, which isn't what AS-009 asks for.

## Notes for the next worker
- The `isCancellingTitleEditRef` pattern (guarding a blur handler against a synchronous `blur()` call made before a state update has flushed) is a reusable gotcha if a future feature adds Escape-to-cancel to another inline-editable field in this same file (e.g. if start/due date ever gain free-text inline editing).
- No MCP tools were used — this is a pure client-side/application-code change, no external service or live schema involved.
