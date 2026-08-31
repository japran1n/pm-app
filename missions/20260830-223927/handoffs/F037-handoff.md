# Handoff: F037 — Fix AS-024 — complete tombstone implementation + real test

## Status
COMPLETE

## Assertions covered
AS-024: PASS — three fixes applied. (1) The regression test now imports and calls the REAL production `applyRealtimePatches` (newly exported from `components/command/command-palette.tsx`) instead of a local re-implementation, so the test fails if `isTombstone`/the tombstone branch regresses. (2) Tombstones are now written unconditionally on every delete/soft-delete realtime event, independent of whether the task is currently present in `results` — previously the tombstone was only derived by diffing `results` before/after a `setResults` call, so a DELETE arriving before the task ever entered `results` (e.g. mid-debounce on the very first search) wrote no tombstone and a later-resolving stale search response for that id was never filtered. (3) The realtime patch map is now reset via a single `resetPaletteState()` routine called from every close path: `handleOpenChange` (dialog close/backdrop/Escape), the Cmd+K toggle listener (which calls `setOpen` directly, bypassing `handleOpenChange`), `navigate()` (search-result/recent selection, also bypasses `handleOpenChange`), and the quick-action branch that closes without navigating.

## Files changed
components/command/command-palette.tsx
lib/hooks/use-palette-search-realtime.ts
tests/unit/f034-fix-realtime-bugs.test.ts

## Commands run
`npx vitest run tests/unit/f034-fix-realtime-bugs.test.ts tests/unit/palette-search-realtime.test.ts` (0) — 17/17 passed
`npx vitest run tests/unit -t palette` (0) — 43/43 passed (187 unrelated files skipped by the `-t` filter)
`npx eslint components/command/command-palette.tsx lib/hooks/use-palette-search-realtime.ts tests/unit/f034-fix-realtime-bugs.test.ts` (0)
`npx tsc --noEmit` (0)
`npm test` (0 exit code overall; 332/386 test files passed, 2504/2783 tests passed — all 83 failing tests are in `tests/integration/*`, unrelated to this feature's files (none reference command-palette/realtime-hook/palette-search paths), failing with Supabase test-account `Request rate limit reached` errors and an unrelated pre-existing `tasks.assignee_id` mirror-column bug in `tests/integration/task-assignees-multi.test.ts` — the same class of pre-existing flakiness already documented in F031's and F034's handoffs. No unit test — including every test file that exercises the three files this feature touched — failed.)

## Decisions made
- Exported `applyRealtimePatches`, `isTombstone`, and the `RealtimeTaskPatch` type from `command-palette.tsx` (previously module-private) so the AS-024 test can call the real production function rather than mirroring its logic — this was the explicit instruction ("must fail if `isTombstone` is removed from the production code").
- For bug #2 (tombstone missed when task not yet in `results`), rather than trying to keep deriving the tombstone from a `results`-diff in `command-palette.tsx`, threaded a new optional `onDeletedTaskId` callback through `usePaletteSearchRealtime` (`lib/hooks/use-palette-search-realtime.ts`) that fires directly off the raw realtime event stream (DELETE, or UPDATE with `deleted_at` set) inside the existing debounce `flush()`, before the `results` reduce runs. This is deterministic regardless of `results` state and doesn't depend on a task having ever rendered. `usePaletteSearchRealtime` only has one other production caller (the test file `tests/unit/palette-search-realtime.test.ts`), and the new fourth parameter is optional so that file's existing calls (which don't pass it) are unaffected — reran that suite to confirm (17/17 pass, including it, in the combined run above).
- Removed the now-redundant results-diff-based tombstone write from `handleRealtimeResults` (title-patch diffing there is retained, only the delete-detection branch was removed) since the dedicated `handleTaskDeleted` callback now owns tombstone-writing unconditionally.
- For bug #3 (patch map surviving across sessions), extracted the existing `handleOpenChange`'s close-branch body into a shared `resetPaletteState()` function and called it from every other `setOpen(false)`/toggle-to-closed call site found in the file: the Cmd+K `document.addEventListener("keydown", ...)` handler's `setOpen((current) => !current)` toggle, `navigate()` (used by every search result/recent-item selection), and the quick-action `onSelect` branch that closes without navigating (`action.run(...)` with no `navigateTo`). `handleOpenChange` itself still calls `setOpen(next)` then `resetPaletteState()` on close, matching prior behaviour exactly for that path.

## Out-of-scope work needed
- Same pre-existing, unrelated integration-test flakiness noted in F034's and F031's handoffs: `tests/integration/task-assignees-multi.test.ts` (`AS_289`/`AS-290` — a genuine, separate bug where `setTaskAssignees` doesn't keep the deprecated `tasks.assignee_id` mirror column in sync) and numerous `tests/integration/*` files failing on Supabase test-account rate limiting (`Request rate limit reached`). Not investigated further — out of this feature's scope (AS-024 / command palette realtime only).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to add a fourth optional parameter to `usePaletteSearchRealtime` rather than duplicating delete-detection logic client-side in `command-palette.tsx` by re-inspecting raw Supabase payloads there — the hook already parses `PaletteRealtimeEvent` shapes and is the single owner of "what changed," so extending its existing debounced `flush()` to also report deleted ids keeps that parsing in one place and avoids the component reaching into realtime event internals a second time.

## Notes for the next worker
- `applyRealtimePatches`/`isTombstone`/`RealtimeTaskPatch` are now exported from `components/command/command-palette.tsx` — safe to import directly in tests going forward instead of re-implementing the tombstone contract.
- `usePaletteSearchRealtime`'s new `onDeletedTaskId?: (id: string) => void` parameter fires for BOTH hard `DELETE` events and soft-delete `UPDATE` events (`deleted_at` set) — mirrors the same two cases `reconcilePaletteSearchResults` already handles for the `results`-mutation side, just decoupled from `results` membership.
- No MCP tools were needed for this feature (pure client-side realtime-state bug fix, no schema/live-config changes).
