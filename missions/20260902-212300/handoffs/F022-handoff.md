# Handoff: F022 — board realtime drag guard, call-site coverage (fix-up, attempt 2)

## Status
COMPLETE

## Assertions covered
AS-025: PASS — `tests/unit/f022-board-realtime-guard-call-site.test.tsx` (real board render + real drag) and `tests/unit/board-optimistic-move-realtime-guard.test.ts` (module-level, pre-existing/kept)
AS-026: PASS — same test file, "AS-026/AS-027: once the in-flight action settles, a LATER Realtime UPDATE for the same task IS applied" section of `test_AS_025_...` plus module-level tests
AS-027: PASS — same as AS-026 (failure/settle release path exercised via `.finally` on the mocked `moveAndReorderTask`)
AS-028: PASS — module-level tests (`AS-028: an UPDATE for a task with no in-flight move at all is applied immediately`, and its negative control) plus the new call-site test's later-UPDATE assertion

## Files changed
tests/unit/f022-board-realtime-guard-call-site.test.tsx (new)

## Commands run
`npx vitest run tests/unit/f022-board-realtime-guard-call-site.test.tsx` (0, 1 passed)
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 16 pre-existing warnings, none in the new file)
`npx vitest run tests/unit/*board*` (0, 25 files / 143 tests passed)
`npx vitest run tests/unit` (0, 206 files / 1603 tests passed)
`npm test` (vitest run, full suite incl. tests/integration against live Supabase) — unit suite green; several **pre-existing** integration-test failures unrelated to this change (recurrence generation, notification fanout, watchers, board-reload-persistence, f221/f327 RLS suites) — none touch `components/board/board.tsx`, `lib/board/pending-moves.ts`, or realtime drag guarding; consistent with this repo's documented integration-suite flakiness against a live remote Supabase project (see vitest.config.ts's own comment on non-deterministic integration runs). Confirmed `board.tsx` is byte-identical to `git show HEAD:components/board/board.tsx` after mutation testing (see below), so this feature introduced no production-code change that could cause them.

## Decisions made
- Chose "mount the real `<Board>`, drive a real cross-column drag via a captured `onDragEnd`, fire a real Realtime callback" over the alternative allowed by the spec (extracting the handler further) — the guard's decision logic was already extracted (F017's `lib/board/pending-moves.ts`); the gap scrutiny-2 identified was specifically that the CALL SITE inside `board.tsx` was unexercised, so a test that renders `board.tsx` and exercises that exact code path is the more direct fix and requires no further extraction (which risks another "well-tested unit, untested wiring" gap one layer up).
- Mocked only `@dnd-kit/core`'s `DndContext` (capture `onDragEnd`, render children as-is) and `DragOverlay` (render children, which is `null` here since `onDragStart` is never invoked in this test) — every other dnd-kit export (`closestCorners`, `useSensor(s)`, `KeyboardSensor`, `PointerSensor`, `sortableKeyboardCoordinates`) and all of `@dnd-kit/sortable` stay real, so `SortableContext`/`useSortable` inside `BoardColumn` render normally. This avoids simulating pointer/keyboard sensor activation (impractical in jsdom for a reliable, non-flaky test) while still calling board.tsx's REAL, unmodified `handleDragEnd`.
- Left `moveAndReorderTask`'s promise unresolved via a controllable deferred (`resolveMoveAndReorder`) so `pendingMovesRef` has a genuine in-flight entry for the duration of the stale-UPDATE assertion, then resolved it manually to prove the guard releases (AS-026/AS-027) rather than staying stuck forever.
- Reused the exact "channel().on().subscribe(); capture the dispatch callback" Supabase mock shape already established by `tests/unit/f027-calendar-realtime-wiring.test.tsx`, since `lib/board/subscribe-board-realtime.ts` calls the client the same way via `acquireSharedTopicChannel`.
- Kept the existing `tests/unit/board-optimistic-move-realtime-guard.test.ts` file untouched — its module-level tests of `lib/board/pending-moves.ts` are genuinely good (scrutiny-2 said so explicitly) and remain the fastest, most precise coverage of the bookkeeping logic itself; the new file adds only what was missing (the call-site wiring).

## Out-of-scope work needed
None for this feature. Scrutiny-2's other findings (AS-014, AS-016, AS-022/AS-023/AS-024 realtime-auth races, F012's BLOCKER-1/2/3 in `lib/actions/portal-approval.ts` and the `approve_portal_task_atomic` RPC) are all outside this feature's assigned assertions (AS-025..AS-028) and outside its Touches scope (`components/board/board.tsx` read-only reference + `lib/board/pending-moves.ts` + a new test file) — explicitly not touched here, per the mission instructions forbidding scope creep into `components/portal/` and `lib/actions/`.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "the realtime callback with the guard in place" as requiring a REAL drag (via the real `handleDragEnd`) rather than manually reaching into `pendingMovesRef` from the test (which isn't exposed, and would itself have been a form of test-only scaffolding not exercising board.tsx's actual wiring end-to-end). Chose the DndContext-capture approach over a full pointer-event simulation because pointer/touch sensor activation in jsdom is not a supported, reliable path for dnd-kit and would make the test flaky without adding rigor — the thing under test (the guard's call site) doesn't care how `onDragEnd` gets invoked, only that it's the real handler wired to the real state.

## Notes for the next worker
- Mutation-verified locally (not left in the repo): temporarily inverted `components/board/board.tsx:291` to `if (!shouldSkipRealtimeUpdate(pendingMovesRef.current, event))` — new test FAILED (asserted `in_progress` column text content, got the reverted-to-`todo` DOM instead). Restored, then temporarily DELETED the guard `if (...) { return current; }` block entirely — new test FAILED the same way. Restored `board.tsx` from `git show HEAD:components/board/board.tsx` and confirmed byte-identical via `diff` before committing; `git status`/`git diff` on `components/board/board.tsx` is clean.
- `tests/unit/f022-board-realtime-guard-call-site.test.tsx` is `@vitest-environment jsdom` (opt-in per repo convention, see `vitest.config.ts`'s comment on the global default staying `node`).
- If a future worker needs to simulate a same-column reorder or a cross-lane drag through this same harness, the `over.id` passed to the captured `onDragEnd` needs to be an existing task's id or a column's `name`/`status` value (ungrouped board) — see `handleDragEnd`'s `parseDndId`/`overTask` resolution in `components/board/board.tsx` for the exact id shapes it expects.
