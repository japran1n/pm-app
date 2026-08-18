# Handoff: F045 — move task status action

## Status
COMPLETE

## Assertions covered
AS-069: PASS — dragging a task card to a different column updates its status to that column's status; verified by integration test against the real linked Supabase project plus a source-level wiring test on the board's onDragEnd handler.

## Files changed
lib/actions/tasks.ts
lib/validation/tasks.ts
components/board/board.tsx
tests/integration/move-task-status.test.ts
tests/unit/board-move-status-wiring.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint components/board/board.tsx lib/actions/tasks.ts lib/validation/tasks.ts tests/integration/move-task-status.test.ts tests/unit/board-move-status-wiring.test.ts` (0)
`npx vitest run` (0) — 238 tests passed (43 files), including the 3 new AS-069 integration tests and the 6 new component-wiring tests
`npx next build` (0)

## Decisions made
- `moveTaskStatus(taskId, newStatus)` follows the exact pattern already established by `assignTask`/`editTask`/`deleteTask`/`updateTaskTags` in `lib/actions/tasks.ts`: Zod-validated input (`moveTaskStatusSchema` in `lib/validation/tasks.ts`, restricting `status` to the same fixed 4-value enum as `createTaskSchema`), workspace looked up server-side via the task's project (never trusted from the client), membership re-checked with `requireActiveMembership` (defense in depth, AS-143), admin client for the update, discriminated-union return, generic user-facing errors with details logged server-side (AS-146), targeted `revalidatePath` with the same non-fatal try/catch rationale as its siblings.
- No per-task ownership/authorship check — any active workspace member may move any task, mirroring `editTask` (AS-061) and `deleteTask` (AS-055)'s established access model. Nothing in AS-069 or the clarified spec suggests a stricter rule.
- `board.tsx`'s `onDragEnd` calls `moveTaskStatus(movedTask.id, movedTask.status)` only when `movedTask.status !== activeTask.status` (i.e. an actual cross-column drop) — a same-column reorder never calls it. Call is optimistic: local state (`next`) is already applied by the time the call fires; on `!result.ok` the handler rolls back to the pre-drop `current` snapshot via `setTasks(current)`.
- Position persistence is explicitly NOT handled here — the prior `TODO(F045)` marker was replaced by the real call, and the `TODO(F046)` marker for position-persist was left in place immediately below it, unchanged in wording, since F046 layers onto this same handler next.
- Component-level test: this repo has no jsdom/@testing-library (`vitest.config.ts` pins `environment: "node"`), and dnd-kit sensors only activate on real browser pointer/keyboard events — `tests/unit/board-dnd-setup.test.ts` (F043) already established source-level inspection as the accepted pattern for this constraint and explicitly defers real drag-interaction testing to F090. `tests/unit/board-move-status-wiring.test.ts` follows that same pattern: renders the real component tree with `moveTaskStatus` mocked to confirm no crash, then inspects `board.tsx`'s source to confirm the import, the change-guard condition, the correct call arguments, and the rollback-on-failure branch are all actually present — not just that *a* function is called.

## Out-of-scope work needed
- F046 (position persistence): recomputing and persisting `position` for the moved task's new column (and the column it left, if different) on every drop, same-column or cross-column. The `TODO(F046)` marker in `components/board/board.tsx`'s `onDragEnd` marks exactly where this plugs in.
- F090 (per clarified spec of F043): a real jsdom/Testing-Library-driven interaction test that actually simulates a pointer or keyboard drag and asserts the resulting DOM/state change end-to-end, once F046 lands and there's real persisted ordering worth asserting against.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a source-level regex-based test for the component-level "cross-column drop triggers the action" check instead of a real simulated drag, because this repo has no jsdom/@testing-library dependency and dnd-kit sensors require real browser input events — the same constraint and resolution already established by F043's `board-dnd-setup.test.ts`, whose own comments explicitly defer real interaction testing to F090.

## Notes for the next worker
- `lib/actions/tasks.ts` now has five sibling Server Actions (`createTask`, `assignTask`, `editTask`, `deleteTask`, `updateTaskTags`, `moveTaskStatus`) all following the identical membership-check/admin-client/discriminated-union/revalidatePath shape — if you're adding a sixth, copy `moveTaskStatus` as the template, it's the shortest.
- `tests/integration/move-task-status.test.ts` uses the `SUPABASE_URL`/`SUPABASE_SECRET_KEY` env-gated `describe.skipIf` pattern from `tests/integration/assign-task.test.ts` — it ran (not skipped) in this environment and all 3 cases passed against the real linked Supabase project.
- No MCP tools were used for this feature (mcp-registry.md marks "Worker use: none" for F045, matching the feature spec's own note).
