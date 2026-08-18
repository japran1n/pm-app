# Handoff: F051 — board column counts

## Status
COMPLETE

## Assertions covered
AS-083: PASS — column task counts derive live from board.tsx's single `tasks` useState array (the same array both handleDragEnd's optimistic update and useBoardRealtime's reconcileTask mutate via setTasks), filtered per column and passed straight into BoardColumn's `tasks` prop; BoardColumn renders `tasks.length`, so the count re-renders automatically on any state change with no manual refresh needed. Verified with a new test that simulates a cross-column drag-and-drop move and checks both the source and destination columns' rendered counts update correctly.

## Files changed
components/board/board-column.tsx
tests/unit/board-column-counts.test.ts

## Commands run
`npm test` (0) — 269/269 passed across 49 files, including the new board-column-counts.test.ts
`npm run lint` (0)
`npx tsc --noEmit` (0)
`npm run build` (0) — production build succeeded

## Decisions made
- The count was already live-derived (`tasks.length` off the `tasks` prop, which board.tsx fills from its single `useState` array touched by both drag-and-drop and Realtime) — no data-source bug to fix. Only the display was changed: moved the count from a separate trailing `<span>` (bare number) into the header text itself as `"To Do (2)"`, matching the format given in the feature spec's example ("To Do (4)").
- Did not touch board.tsx's state management — it already satisfies the "live local board state" requirement (AS-083) exactly as specced; changing it further would be out of scope for a display-only feature.
- Test simulates the drag-and-drop move by building the same `next` array shape handleDragEnd's setTasks updater produces in board.tsx (moved task's status flipped, filtered per column the same way board.tsx's JSX does), then renders BoardColumn against pre- and post-move arrays to prove both source and destination counts update. No jsdom/@testing-library in this repo (vitest.config.ts pins `environment: "node"`), so this follows the established source-level + render pattern used by tests/unit/board-move-status-wiring.test.ts and board-optimistic-rollback-toast.test.ts rather than firing real DnD pointer events.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to fold the count into the `<h2>` label text ("To Do (2)") rather than keep a separate trailing element, since the feature spec's own example ("To Do (4)") shows the count inline with the label, not as a detached badge.

## Notes for the next worker
The count logic was correct before this feature — board.tsx already had exactly one `tasks` state array shared by drag-and-drop and Realtime reconciliation, and BoardColumn already read `tasks.length` from its prop each render. If a future feature ever introduces a second/derived tasks array (e.g. a filtered or sorted view), make sure BoardColumn keeps reading from whatever is the single source of truth mutated by both DnD and Realtime, not a snapshot.
