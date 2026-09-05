# Handoff: F038 — Fix AS-024: missing test coverage for onDeletedTaskId and resetPaletteState

## Status
COMPLETE

## Assertions covered
AS-024: PASS — new tests added covering the two mutation-survivable gaps (raw DELETE -> onDeletedTaskId, and navigate() -> resetPaletteState clearing the patch map). Verified each new test fails when the corresponding production code line is stubbed/removed, then passes again with the code restored.

## Files changed
tests/unit/f038-as024-coverage.test.ts (new)

## Commands run
`npx vitest run tests/unit/f038-as024-coverage.test.ts tests/unit/f034-fix-realtime-bugs.test.ts tests/unit/palette-search-realtime.test.ts tests/unit/command-palette-shell.test.tsx` (0)
`npx eslint tests/unit/f038-as024-coverage.test.ts` (0)
`npx tsc --noEmit` (0)
`npx vitest run tests/unit` (0) — 195 files / 1496 tests passed

## Decisions made
- Wrote two new tests rather than modifying `tests/unit/f034-fix-realtime-bugs.test.ts`, to keep the mutation-closing tests scoped to this feature and avoid touching the file scrutiny already reviewed.
- Test 1 (`test_AS_024_raw_delete_event_invokes_onDeletedTaskId_with_the_deleted_id`) uses `renderHook` on `usePaletteSearchRealtime` directly with a mocked `createClient`, fires a raw `eventType: "DELETE"` payload (not a soft-delete UPDATE with `deleted_at`), waits out the 100ms reconcile debounce, and asserts `onDeletedTaskId` was called with the deleted id exactly once. This is the branch no prior test exercised — every existing test only drove the soft-delete UPDATE path.
- Test 2 (`test_AS_024_navigate_clears_the_tombstone_so_a_later_session_no_longer_filters_the_task`) renders the real `<CommandPalette>`, opens it, searches, fires a raw DELETE for a task (tombstoning it), then clicks a member result — which calls `navigate()` directly (not `navigateAndRecord`) — to close the palette. It then reopens the palette and searches again with the same mocked `searchPalette` response (which still includes the "deleted" task, since the tombstone lived only in the client-side patch map). Asserting the task reappears proves the patch map was cleared by `navigate()`'s call to `resetPaletteState()`; if that call is removed, the stale tombstone silently survives into the next session and the task never reappears, failing the test.
- Both new `describe` blocks in the file share ONE `vi.mock("@/lib/supabase/client", ...)` and one `sharedOnCalls` array, because a second `vi.mock` call for the same module path in the same test file overrides rather than stacks — this caused a real (now-fixed) cross-test bug during development where the second describe block's subscription silently went to a different fake channel object than expected. Also explicitly `unmount()` the `renderHook` instance in test 1 so its lingering effect/timer doesn't interfere with test 2's render in the same file.
- Verified both new tests are mutation-sensitive by hand: stubbing out both `onDeletedTaskId(...)` call sites in `use-palette-search-realtime.ts` failed test 1; removing `resetPaletteState()` from `navigate()` in `command-palette.tsx` failed test 2. Both production files were restored from backup after verification (git diff confirms no production code changes remain).

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
None.

## Autonomous decisions
None — spec was unambiguous and self-contained (two specific line-level gaps named in the feature spec).

## Notes for the next worker
- Pattern for testing this hook/component pair: see `tests/unit/palette-search-realtime.test.ts` (`openPaletteWithQuery` helper + `wiringOnCalls` capture pattern) — the new file follows the same shape but keeps a single shared `vi.mock` for the Supabase client across its two `describe` blocks.
- Unrelated files show as modified/untracked in `git status` (`components/calendar/calendar-day-grid.tsx`, `lib/calendar/reconcile-realtime-task.ts`, `tests/unit/f040-calendar-realtime-date-scope.test.ts`, various `missions/20260830-223927/*` mission-state files) — these belong to other in-flight work in this mission and were intentionally left untouched/uncommitted by this worker.
