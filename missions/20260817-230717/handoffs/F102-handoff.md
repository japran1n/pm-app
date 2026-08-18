# Handoff: F102 — optimistic rollback partial failure fix

## Status
COMPLETE

## Assertions covered
AS-077: PASS — new integration test `moveAndReorderTask (F102: AS-077)` in tests/integration/move-and-reorder-task.test.ts proves both the happy path (status+position update together) and, critically, atomicity: two dedicated tests inject an invalid position (NaN) or an invalid status alongside an otherwise-valid cross-column move and assert the server row's `status` AND `position` BOTH remain at their pre-call values — not just that the client would visually roll back. Updated tests/unit/board-move-status-wiring.test.ts and tests/unit/board-optimistic-rollback-toast.test.ts (F045/F047, source-level checks against board.tsx) to reflect the new wiring.

## Files changed
lib/actions/tasks.ts
lib/validation/tasks.ts
components/board/board.tsx
tests/integration/move-and-reorder-task.test.ts
tests/unit/board-move-status-wiring.test.ts
tests/unit/board-optimistic-rollback-toast.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npx vitest run` (0) — Test Files 50 passed (50); Tests 286 passed (286). One earlier run hit a transient `JWT issued at future` error in an unrelated integration suite (clock-skew flakiness against the linked Supabase project, same class of flakiness M2/M5-scrutiny.md notes elsewhere) — re-ran clean, no code-related failures.
`npm test` (0) — 50 passed, 286 passed.
`npm run build` (0) — Next.js production build succeeded, all routes compiled.

## Decisions made
- Chose option (a) from the feature spec (single atomic Server Action) over the compensating-transaction option (b) — matches the spec's explicit recommendation and the precedent cited from F094/F095's atomic-RPC fixes in M2.
- Implemented as a single Postgres `UPDATE ... SET status = ?, position = ?` in one Supabase `.update({ status, position })` call rather than a SECURITY DEFINER RPC — a single-statement UPDATE against one row is already atomic in Postgres (no explicit transaction wrapper needed), and this keeps the same call pattern (Zod validation → auth → membership lookup → admin update → revalidatePath) as `moveTaskStatus`/`reorderTask`, so there's no new migration file, no new grant surface, and reviewers can diff it directly against its two siblings. Reserved the RPC approach as unnecessary extra complexity here since there's no multi-statement work to wrap.
- Added a new combined Zod schema `moveAndReorderTaskSchema` (status enum + finite position) rather than reusing `moveTaskStatusSchema`/`reorderTaskSchema` separately, so both fields are validated together before either reaches the database — this is what makes the "invalid status/position" atomicity test meaningful (validation failure never touches the DB at all, not even partially).
- `moveTaskStatus` and `reorderTask` are both left intact and exported, per the spec's explicit guidance that other callers needing only one field can keep using them. `board.tsx`'s onDragEnd now branches: `moveAndReorderTask` when `movedTask.status !== activeTask.status` (cross-column drag), `reorderTask` alone otherwise (same-column reorder, where there's nothing to coordinate since status never changes).
- Updated two pre-existing unit tests (board-move-status-wiring.test.ts, board-optimistic-rollback-toast.test.ts) that did source-level regex assertions against board.tsx's old two-call wiring — left unchanged they would have false-failed (or worse, false-passed on stale assertions) against the new code. Both were in scope since they directly assert on the exact lines this fix touches.

## Out-of-scope work needed
- Finding 1 (M5-scrutiny.md, HIGH, AS-072/AS-082): `lib/board/position.ts`'s `calculatePosition` fallback nudge can produce a value outside `[prev, next]` under repeated-insert precision collapse. Not touched here — separate root cause, separate file, no overlap with this fix's scope.
- Finding 3 (M5-scrutiny.md, MEDIUM, AS-076): `lib/board/reconcile-realtime-task.ts`'s `reconcileTask` has no defense against out-of-order Realtime event delivery for the same task id. Not touched here — separate file, separate concern.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the plain single-UPDATE implementation over a SECURITY DEFINER RPC (see "Decisions made" above) since the spec explicitly left the choice open ("...or a SECURITY DEFINER RPC if you judge that cleaner") and a single-statement UPDATE needs no additional transactional wrapping to be atomic.

## Notes for the next worker
- `moveAndReorderTask(taskId, newStatus, newPosition)` lives in lib/actions/tasks.ts immediately after `reorderTask`, and follows the exact same structure (parse → auth → task/workspace lookup → membership check → update → revalidatePath → discriminated-union return) as its two siblings, so diffing against `moveTaskStatus`/`reorderTask` is the fastest way to review it.
- The new integration test file mirrors tests/integration/reorder-task.test.ts's fixture setup (workspace/project/member/outsider users, `loadDotEnv`, `describe.skipIf(!haveAdminCreds)`) — same conventions, so it needs the same `.env` Supabase admin credentials to actually run (it `skipIf`s cleanly otherwise).
- No MCP tools were used for this fix — no schema/migration change was needed since both `status` and `position` are pre-existing columns on `tasks`; the fix is purely an application-layer change to how the two writes are grouped.
