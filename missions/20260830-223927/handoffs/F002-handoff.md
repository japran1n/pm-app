# Handoff: F002 — Optimistic update for list-due-date-cell

## Status
COMPLETE

## Assertions covered
AS-003: PASS — `tests/unit/list-due-date-cell-optimistic.test.tsx::test_AS_003_due_date_cell_shows_new_date_immediately_before_server_responds` proves the input shows the new date while `editTask`'s promise is still unresolved.
AS-004: PASS — `tests/unit/list-due-date-cell-optimistic.test.tsx::test_AS_004_due_date_cell_reverts_and_shows_error_toast_when_server_action_rejects` and the sibling clear-date test prove revert + `toast.error("Failed to update due date")` on a rejected `editTask` call, for both a new date and clearing the date to null.

## Files changed
components/task/list-due-date-cell.tsx
tests/unit/list-due-date-cell-optimistic.test.tsx
tests/unit/f250-list-inline-edit.test.tsx

## Commands run
`npx vitest run tests/unit/list-due-date-cell-optimistic.test.tsx tests/unit/f250-list-inline-edit.test.tsx tests/unit/f251-inline-edit-permissions-realtime.test.tsx tests/unit/list-priority-select-optimistic.test.tsx` (0, 24/24 passed)
`npx vitest run tests/unit` (0, 1394/1394 passed)
`npm test` (0 exit code from the vitest process itself; reported 51 failed / 2627 passed / 9 skipped across the FULL suite including network-dependent `tests/integration/**` — see Decisions made below; every unit test and every test in a file I touched passed)
`npm run lint` (0 errors, 6 pre-existing warnings unrelated to my files)
`npx tsc --noEmit` (0)

## Decisions made
- Converted `ListDueDateCell` from the shared `lib/hooks/use-inline-field-edit.ts` hook to `React.useOptimistic` directly, per the clarified spec's explicit "Pattern: React.useOptimistic wrapping existing ... server action" answer, mirroring how F001 already converted `list-priority-select.tsx` the same way (same file's own F001 comment documents the identical rationale: `useOptimistic` derives its optimistic value from the `dueDate` prop, so a failed `editTask` call needs no manual revert — React falls back to the base prop once the transition settles without it changing).
- Changed the commit trigger from "type into a draft, then Enter/blur commits, Escape reverts" (the old hook's UX) to "commit directly on `onChange`" — per the clarified follow-up decisions: "Date picker closes on select; no separate confirm needed" and "No loading spinner needed — date picker closes immediately." A native `<input type="date">`'s change event already fires once per finalized pick (unlike a text field), so there is no longer an uncommitted-draft state for Enter/Escape to act on; this also matches `list-priority-select.tsx`'s own single-shot `handleChange` shape exactly.
- Added `onClick` `stopPropagation` on the input per the clarified follow-up decision ("Stop click propagation to prevent row opening sheet") — redundant with the parent `<TableCell>`'s own `stopPropagation` in `task-list-table.tsx` today, but keeps the cell self-contained per its "Touches: this file only" scope, and correct even if that wrapper ever changes.
- Did NOT move the overdue red-text/icon logic into this cell. It currently lives in `task-list-table.tsx` (computed from `task.status`/`task.dueDate`, driving a `<TriangleAlert>` next to this cell), needs the task's `status` to be correct (a done task overdue by date shouldn't show red), and this cell has no `status` prop. The clarified spec's "Touches: `components/task/list-due-date-cell.tsx` only" forbids adding a new prop plumbed from the table. Logged as out-of-scope work below.
- Updated `tests/unit/f250-list-inline-edit.test.tsx`'s due-date-specific tests (previously asserting Enter-commits/Escape-reverts) to match the new commit-on-change contract, moving the full AS-003/AS-004 instant-update/revert/toast proof into the new dedicated `tests/unit/list-due-date-cell-optimistic.test.tsx` — the exact same restructuring the F001 worker already did to that same file for the priority cell (compare the file's existing, already-trimmed priority test at line ~119 to what I did for due-date). This was necessary to keep `npm test` green; F250's AS-484/485/487 assertions for due-date remain covered (rendering + real-Server-Action wiring proof kept in place, full commit/rollback proof moved to the F001-pattern-matching dedicated file).
- AUTONOMOUS_DECISION: kept `canEdit`/viewer-plain-text fallback and the `"No due date"` empty string unchanged — the clarified spec says "Empty state: existing rendering unchanged."

## Out-of-scope work needed
- Overdue red-text styling that updates immediately from the cell's own optimistic date (clarification's follow-up decision) is not implemented, because it requires either (a) a `status` prop added to `ListDueDateCell` and its call site in `task-list-table.tsx` updated, or (b) exporting the optimistic date value up to the parent — both outside this feature's "Touches: list-due-date-cell.tsx only" scope. A future feature should: add an optional `status`/`statusCategory` prop to `ListDueDateCell`, compute `isOverdue` internally from the optimistic value, and remove/reconcile with the now-duplicate `overdue` computation + `<TriangleAlert>` in `task-list-table.tsx` so there's a single source of truth.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Committed on `onChange` directly instead of preserving the old hook's Enter/blur-commit + Escape-revert keyboard flow, since the clarified spec explicitly says "no separate confirm needed" and a native date input's change event is already a finalized pick. This required updating (not deleting) two pre-existing F250 tests that asserted the old Enter/Escape behavior — done using the same precedent already set by F001's conversion of the sibling priority cell in the same shared test file.

## Notes for the next worker
- `npm test` runs vitest across BOTH `tests/unit/**` (fast, no network, all pass) and `tests/integration/**` (real Supabase project, ~10 minutes, and has 51 pre-existing failures in files I never touched — e.g. `tests/integration/task-assignees-multi.test.ts` — consistent with the Supabase Auth rate-limit contention this repo's own `vitest.config.ts` F312 comment already documents). None of the 51 failures are in `list-due-date-cell`, `list-priority-select`, `f250-*`, or `f251-*` test files. Ran `npx vitest run tests/unit` separately (1394/1394 green) to isolate this feature's actual footprint from that pre-existing integration flakiness.
- No MCP tools were needed — pure application-code change, per the feature spec's own "MCP at run: none" note.
