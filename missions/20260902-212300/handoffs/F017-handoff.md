# Handoff: F017 — Board optimistic-move realtime guard, behavioural tests

## Status
COMPLETE

## Assertions covered
AS-025: PASS — `shouldSkipRealtimeUpdate` unit-tested directly with a guarded id (skip) and with an inverted-guard mutant confirmed FAIL; also wired live in board.tsx.
AS-026: PASS — lifecycle test: guard → release-on-success → next UPDATE applied.
AS-027: PASS — lifecycle test: guard → release-on-failure path (same `.finally` release used for `{ok:false}`/thrown rejection) → next UPDATE applied.
AS-028: PASS — previously zero coverage; now direct test that an UPDATE for a task with no in-flight move is applied immediately, plus a negative-control test (a guarded OTHER task doesn't affect it).

## Files changed
lib/board/pending-moves.ts (new)
components/board/board.tsx
tests/unit/board-optimistic-move-realtime-guard.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0, same 15 pre-existing warnings, 0 errors)
`npx vitest run --exclude tests/integration --exclude tests/e2e` (0) — 206 files / 1590 tests passed
`npx vitest run tests/unit/board-optimistic-move-realtime-guard.test.ts` (0) — used repeatedly during mutation verification

## Decisions made
- Extracted `pendingMovesRef`'s add/release/isGuarded bookkeeping AND the realtime UPDATE skip-decision (previously inline `event.eventType === "UPDATE" && event.new && pendingMovesRef.current.has(event.new.id)`) into a new pure module `lib/board/pending-moves.ts`, matching this codebase's existing pattern of pure helpers under `lib/board/` (`reconcile-realtime-task.ts`, `position.ts`) and the scrutiny report's FU-B recommendation. `board.tsx` now calls `shouldSkipRealtimeUpdate(pendingMovesRef.current, event)` — behaviour is identical to before (same predicate, same order relative to the INSERT-placeholder branch), only the implementation moved.
- Discarded the entire prior test file (regex-over-source-text) and replaced it with tests that import and call the real exported functions from `lib/board/pending-moves.ts` with a real `Map` and synthetic realtime events — this is what actually executes the reference-counting and skip-decision logic instead of matching string patterns.
- Kept one lightweight `renderToStaticMarkup` smoke test (same shape as before) as a wiring/compile check that board.tsx still imports and uses the module without crashing — not relied on for behavioural coverage.
- `shouldSkipRealtimeUpdate`'s event type is intentionally loose (`{ eventType: string; new?: { id?: string } | null }`) rather than importing `BoardRealtimeEvent`, so the pure module has no dependency on Supabase realtime payload types and stays trivially testable with plain object literals; `board.tsx` passes its real `BoardRealtimeEvent` straight through (structurally compatible — `RealtimePostgresDeletePayload`'s `new` is `{}`, hence `id?: string` rather than `id: string`).

## Out-of-scope work needed
None for this feature — F017's scope was strictly this test file plus the minimal extraction needed to make it behavioural, per the spec. The other scrutiny findings (FU-A, FU-C through FU-H) are separate features/follow-ups not assigned to F017 and were left untouched. Did not touch anything under `components/portal/`.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to extract the skip-decision (`shouldSkipRealtimeUpdate`), not just the counter (`addPendingMove`/`releasePendingMove`), into the pure module. The spec's suggested-followup text only explicitly asked for extracting "the pending-move bookkeeping (add/release/isGuarded)" and separately said to "add a test that exercises the realtime callback's decision function" — extracting the decision function itself, not just calling it while still embedded in board.tsx's `setTasks` closure, was necessary to make it independently unit-testable without simulating a real dnd-kit drag (this repo's vitest config is `environment: "node"` with no jsdom drag-simulation precedent for `handleDragEnd`) or mounting the full component with jsdom. This is a strict superset of what was asked and keeps board.tsx's runtime behavior byte-for-byte identical (same three-part boolean predicate, evaluated in the same place).

## Notes for the next worker
- Mutation-verified both mutants named in the scrutiny finding plus the counter mutant, restoring the source and re-running the full board guard test file green after each:
  1. Inverted guard (`!isMoveGuarded(map, id)` in `shouldSkipRealtimeUpdate`) → 6 of 14 tests failed. Restored → 14/14 pass.
  2. Unconditional `releasePendingMove` (`map.delete(taskId)` with no count check) → 1 test failed (`"a cross-lane drag (two Server Actions) stays guarded until BOTH settle…"`). Restored → 14/14 pass.
  (Mutant 1 and the counter-mutant test above are the same two the scrutiny report named as surviving; both are now killed by direct function calls rather than regex.)
- No MCP tools used — this feature is pure client-side React/TypeScript logic with no external service surface.
