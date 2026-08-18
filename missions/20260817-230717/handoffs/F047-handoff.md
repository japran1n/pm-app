# Handoff: F047 — board optimistic ui

## Status
COMPLETE

## Assertions covered
AS-077: PASS — a card's optimistic UI position during drag reverts correctly if the server update fails (verified via tests/unit/board-optimistic-rollback-toast.test.ts and tests/unit/board-move-status-wiring.test.ts's updated rollback assertion; both mocked-failure and real drag-gesture DOM interaction cannot be exercised in this repo's vitest `environment: 'node'` config — see Notes below — so coverage is source-level + render-without-crash, matching the existing precedent set by tests/unit/board-move-status-wiring.test.ts and tests/unit/board-dnd-setup.test.ts).

## Files changed
components/board/board.tsx
tests/unit/board-move-status-wiring.test.ts
tests/unit/board-optimistic-rollback-toast.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npm test` (0 for board-related suites; 1 pre-existing unrelated integration test failure — see Notes)
`npm run build` (0)

## Decisions made
- Investigated board.tsx's existing onDragEnd (from F045/F046): the optimistic update was already synchronous — `setTasks` is called with the fully-computed `next` array (moved card's new status/position already applied) inside the same synchronous updater pass that then kicks off the `moveTaskStatus`/`reorderTask` calls. So the "local state persists post-drop while async calls are in flight" requirement was already satisfied by F046's implementation; I added a test (`board-optimistic-rollback-toast.test.ts`) that pins this ordering by source position (setTasks updater → movedTask computed → action calls invoked → `next` returned) so a future refactor can't silently move the optimistic update to be conditional on the action promises.
- F047's actual gap was: (a) no error toast on rollback, and (b) `moveTaskStatus`/`reorderTask` failures were rolled back independently with no shared logic, and a thrown rejection (network error, not just `ok:false`) wasn't caught at all — `void moveTaskStatus(...).then(...)` with no `.catch` would produce an unhandled promise rejection instead of rolling back.
- Introduced a shared `rollback(message)` helper (declared once per drop, inside the `setTasks` updater closure) that: guards against double-rollback/double-toast via a `rolledBack` flag (both action calls can fail independently and resolve in either order — only the first failure should roll back and toast), calls `setTasks(current)` to restore the pre-drop snapshot, and calls `toast.error(message)`.
- Added `.catch(() => rollback(...))` to both `moveTaskStatus` and `reorderTask` calls so a thrown/rejected Server Action call (not just an `ok:false` response) also triggers rollback + toast, per the task's "or throws" requirement.
- Used `result.error` (the existing discriminated-union error string already returned by both Server Actions) as the toast message on `ok:false`, and a generic fallback message for the `.catch` (thrown) case, matching the `toast.error(result.error)` pattern already established in edit-project-dialog.tsx / new-project-dialog.tsx / invite-member-form.tsx / revoke-invite-button.tsx.
- Updated the pre-existing `board-move-status-wiring.test.ts` rollback assertion (from F046) to match the new `rollback()`-helper indirection instead of asserting `setTasks(current)` inline at each call site — the old regex would otherwise false-fail against legitimately improved behavior.

## Out-of-scope work needed
- True drag-gesture interaction testing (real pointer/keyboard events causing an actual card element to visually move and revert in a rendered DOM, plus asserting a rendered toast element) is not possible in this repo today: `vitest.config.ts` pins `environment: 'node'` and no jsdom/@testing-library packages are installed. This is the same constraint already documented in `tests/unit/board-dnd-setup.test.ts`, which explicitly defers real interaction testing to F090 (Playwright, "e2e board reorder test"). F090 should additionally assert: on a Server Action failure (can be simulated via a Playwright route intercept/mock of the relevant Supabase/Server Action call, or a temporary feature flag), the dragged card visually returns to its original column/position and a toast with the error text is rendered. Flagging so F090's worker doesn't have to re-derive this from scratch.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept the DoD's "no jsdom/interaction testing" precedent from F045/F046 rather than adding jsdom + @testing-library/react as new devDependencies to attempt a real simulated-drop test. Rationale: this repo's existing worker(s) already made and documented this call twice (board-dnd-setup.test.ts, board-move-status-wiring.test.ts) as a deliberate scope boundary with F090 (Playwright) as the designated owner of real interaction testing; introducing a new, heavier test-tooling dependency for a single component test would be a bigger scope expansion than F047's spec calls for, and would duplicate work F090 is already scoped to do properly (real browser automation, not jsdom's synthetic events, which don't fire dnd-kit's PointerSensor/KeyboardSensor activation constraints anyway).

## Notes for the next worker
- `npm test`'s one failure (`tests/integration/edit-task.test.ts`, "Failed to create test workspace: JWT issued at future") is a pre-existing Supabase auth/system-clock skew issue unrelated to this feature — it fails identically on a clean checkout before this change. Confirmed board-specific suites (`board-optimistic-rollback-toast.test.ts`, `board-move-status-wiring.test.ts`, `board-dnd-setup.test.ts`, `board-column.test.ts`, `board-empty-state.test.ts`, `board-columns-render.test.ts`) all pass.
- No MCP tools used (per feature spec: "MCP at run: none").
