# Handoff: F046 — reorder task position action

## Status
COMPLETE

## Assertions covered
AS-070: PASS — reorderTask updates `position` only; status confirmed unchanged in the same integration test (tests/integration/reorder-task.test.ts).
AS-078: PASS — lib/queries/tasks.ts already ordered by `position` ascending (F042); board.tsx's onDragEnd now computes neighbor positions from that same order via calculatePosition, keeping the invariant intact after a drag.
AS-079: PASS — createTask now computes position via calculatePosition(lastTaskInColumn?.position ?? null, null) instead of F035's placeholder `0`; covered by a new integration test asserting the new task's position is greater than the existing last task's.
AS-080: PASS — confirmed the `tasks_set_updated_at` trigger fired unconditionally (real problem, not hypothetical), fixed via a new migration adding a WHEN clause that excludes position-only updates; integration test asserts updated_at is unchanged after reorderTask but does change after moveTaskStatus.

## Files changed
lib/actions/tasks.ts
lib/validation/tasks.ts
lib/queries/tasks.ts
components/board/board.tsx
components/task/task-card.tsx
supabase/migrations/20260818023746_tasks_updated_at_exclude_position.sql
tests/integration/reorder-task.test.ts
tests/unit/board-move-status-wiring.test.ts
tests/unit/board-column.test.ts
tests/unit/board-dnd-setup.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npm test` (0) — 244 tests passed, 44 files
`npm run build` (0)
`supabase db push --linked` (0) — applied the new updated_at-trigger migration to the linked remote project

## Decisions made
- Added `reorderTask(taskId, newPosition)` to `lib/actions/tasks.ts`, following the exact same pattern as `moveTaskStatus`/`editTask`/`deleteTask` in this file: Zod validation (`reorderTaskSchema` in `lib/validation/tasks.ts`, `position: z.number().finite()`), membership re-verified server-side via `requireActiveMembership`, admin client for the UPDATE (position column only, never touches status), discriminated-union return, generic user-facing errors.
- `reorderTask` and `moveTaskStatus` are deliberately two separate UPDATE calls, both invoked from the same `board.tsx` onDragEnd handler when needed — not merged into one action — matching F045's own doc comment that explicitly deferred position-persist to F046 "layered on top of this same handler."
- **AS-080 investigation (not assumed):** read the `tasks_set_updated_at` trigger in `supabase/migrations/20260818013434_create_tasks.sql` — it's `before update ... for each row` with no WHEN clause, i.e. it fires on *any* UPDATE including a position-only one. This was confirmed to be a real problem: without a fix, every drag (even a same-column reorder) would have bumped `updated_at`, violating AS-080. Fixed with a new migration (`20260818023746_tasks_updated_at_exclude_position.sql`) that replaces the trigger with an equivalent one gated by a `WHEN` clause comparing every real column except `position`/`updated_at` between OLD and NEW — a position-only UPDATE no longer fires the trigger, while every other existing action (editTask, assignTask, deleteTask, updateTaskTags, moveTaskStatus) is unaffected since they all change a column the WHEN clause checks. Applied to the linked remote project via `supabase db push --linked`.
- AS-079: `createTask` in `lib/actions/tasks.ts` now queries the current last task in the target (project_id, status) column (`order position desc limit 1`, `deleted_at is null`) and calls `calculatePosition(lastInColumn?.position ?? null, null)` for the new row's position, replacing F035's hardcoded `position: 0`. This supersedes F035's documented placeholder, per that placeholder's own comment inviting this.
- To let `board.tsx`'s onDragEnd compute real neighbor positions (not just array order) without a network round-trip, added a `position: number` field to `TaskCardTask` (`components/task/task-card.tsx`) and threaded it through `lib/queries/tasks.ts`'s existing `select(... position)` (the column was already selected but previously dropped in the mapped return value). This is additive to the type — no existing consumer broke (confirmed via tsc/lint/tests/build).
- `board.tsx`'s onDragEnd: computes the dropped card's new previous/next neighbors *within the target column* (filtering `withoutActive` by `targetStatus`, honoring the same position-ascending order the board renders), calls `calculatePosition(prevNeighbor?.position ?? null, nextNeighbor?.position ?? null)`, sets the moved task's `position` in local state, then always calls `reorderTask(movedTask.id, newPosition)` (optimistic, rolled back to the pre-drop `current` snapshot on failure) in addition to the pre-existing conditional `moveTaskStatus` call for cross-column drops. Removed the `TODO(F046)` marker this feature was scoped to fill in.
- Updated three existing unit tests that construct `TaskCardTask` literals to include the now-required `position` field, and updated `tests/unit/board-move-status-wiring.test.ts`'s wiring assertions to check for `reorderTask`/`calculatePosition` wiring in place of the now-obsolete "leaves a TODO(F046) marker" assertion — this test exists specifically to pin board.tsx's onDragEnd source shape, and F046's job was precisely to fill in that TODO, so updating it is completing the same contract the test was written against, not silently overriding it.

## Out-of-scope work needed
- AS-071/AS-072/AS-073/AS-074/AS-082 (fractional-index correctness, boundary gaps, rapid-drag corruption) are already covered by `lib/board/position.ts`'s own unit tests (F044) — not re-tested here since `calculatePosition` itself wasn't changed, only its callers.
- AS-081 (soft-deleted tasks never appear mid-drag) and AS-083 (column counts update immediately) are UI/interaction-level assertions better suited to a Playwright pass (F090) than this Server Action feature — flagging for whichever feature owns end-to-end board interaction tests, if not already covered there.
- No periodic position-rebalance pass exists (documented as out-of-scope in `lib/board/position.ts`'s own header comment, inherited unchanged here).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Added `position: number` to `TaskCardTask` and threaded it through `lib/queries/tasks.ts` even though the feature spec's "Files (approximate)" only listed `lib/actions/tasks.ts`. This was necessary to let onDragEnd compute real fractional-index neighbor positions (the spec's own instructions explicitly require wiring `calculatePosition` into board.tsx's onDragEnd using the dropped card's new neighbors, which requires the neighbors' actual `position` values client-side). Kept the change minimal and additive — no existing field removed or renamed.
AUTONOMOUS_DECISION: Investigated whether the `set_updated_at()` trigger fires on position-only updates rather than assuming either way, per the task's explicit instruction — confirmed it does, and applied a migration fix (WHEN clause) rather than a workaround in application code (e.g. re-setting updated_at back after the UPDATE), since a DB-level fix is the correct, race-free way to make "this column's changes don't count as an edit" declarative and impossible to bypass by future callers of the same table.

## Notes for the next worker
- The new migration is `supabase/migrations/20260818023746_tasks_updated_at_exclude_position.sql` — already applied to the linked remote project via `supabase db push --linked` (confirmed applied, not just written).
- `tests/integration/reorder-task.test.ts` follows the exact `loadDotEnv`/`skipIf(!haveAdminCreds)` pattern from `tests/integration/move-task-status.test.ts` — six tests: happy-path reorder (AS-070/AS-078), AS-080's updated_at behavior (reorder vs. status move, using a 1.1s real delay to make a timestamp diff observable), AS-079's append-to-end-of-column, a non-member negative case, and a non-finite-position negative case.
- If a future feature adds more columns to `tasks`, remember to also add them to the new trigger's WHEN clause (or that column's changes will silently stop bumping `updated_at`) — the migration's own comment calls this out.
