# Handoff: W7d — restoreTask atomicity

## Status
COMPLETE

## Assertions covered
No assertion IDs assigned (atomicity hardening task, not an assertion-bearing feature).

## Files changed
supabase/migrations/20260905080000_restore_task_atomic.sql
lib/actions/tasks.ts
lib/supabase/database.types.ts
missions/20260828-hardening/handoffs/W7d-handoff.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/actions/tasks.ts lib/supabase/database.types.ts` (0)
`npx vitest run tests/unit` (1 pre-existing unrelated failure: tests/unit/fts-tasks.test.ts — beforeAll hook times out creating a Supabase admin user, unrelated to restoreTask/tasks.ts; 1389 other tests pass, 3 skipped)

## Decisions made
- Read `restoreTask` (lib/actions/tasks.ts, originally lines ~1617-1867) fully before changing anything. It performed three separate writes after the auth/lookup section: (1) UPDATE the target task (deleted_at/deleted_by/status/position), (2) a per-child loop UPDATE-ing every cascade-deleted child (deleted_via_task_id/status/position/deleted_at/deleted_by), and (3) a non-fatal `writeTaskFieldChanges` activity write. Writes (1) and (2) are NOT independently safe: if the parent update succeeded but the process crashed/errored before or partway through the child loop, the parent would appear live in a board column while its children remained hidden in trash with a `deleted_via_task_id` now pointing at a live task — a real inconsistent state (mirrors the same reasoning already documented for `bulk_delete_tasks_atomic`, its inverse operation). This meets the "2+ writes not independently safe" bar, so an RPC was required.
- Modeled the new `restore_task_atomic(p_task_id uuid)` function directly after the existing `bulk_delete_tasks_atomic` migration: `SECURITY DEFINER`, `set search_path = ''`, `REVOKE ALL ... FROM PUBLIC`, `GRANT EXECUTE ... TO authenticated`. Put in a new migration file rather than editing the existing one, per hard rule against modifying existing migrations.
- The RPC re-derives `project_id`/`status` from a fresh `SELECT ... FOR UPDATE` inside the transaction (rather than trusting values read earlier in the JS action), so the lock and every subsequent read/write are consistent even if the JS-side `taskRow` lookup used moments earlier is stale. It re-verifies the `deleted_at is not null` eligibility gate itself.
- Status-fallback logic (`KNOWN_STATUSES = ['todo','in_progress','in_review','done']`, fallback to `'todo'`) and position logic (append-to-end-of-column) were ported into plpgsql exactly. Position append is always `calculatePosition(lastPosition, null)` in the original JS (never a two-neighbor insert), which the doc comment in the migration shows collapses algebraically to `coalesce(last_position, 0) + 1000` (DEFAULT_POSITION and BOUNDARY_GAP are both 1000 in `lib/board/position.ts`) — verified this is a faithful simplification, not an approximation, before using it.
- The cascade-child loop inside the RPC is bounded by the same one-level-nesting invariant (F148) the original JS loop's own comment relied on, so it stays a small in-transaction loop, not an unbounded one.
- Kept everything that doesn't need to be inside the atomic boundary outside the RPC in the Server Action: the earlier auth/membership/visibility checks, the non-fatal `writeTaskFieldChanges` activity write (unchanged, still wrapped in try/catch, still fires after the RPC using the RPC's returned `updated.status`), the trailing `revalidatePath` calls, and the final result-object construction. Public signature of `restoreTask` (params and return shape) is unchanged.
- Removed the now-dead `KNOWN_STATUSES`/`NOT_STARTED_FALLBACK_STATUS` local consts and the manual `lastInColumn`/`calculatePosition` position lookup and the per-child cascade loop from the JS function body, since all of that logic now lives in the RPC. `calculatePosition` import is still used elsewhere in tasks.ts (verified via grep) so it was left in place.
- Added `restore_task_atomic` to the `Functions` map in `lib/supabase/database.types.ts` (Args: `{ p_task_id: string }`, Returns: array of `{ id, project_id, status, position, status_was_reset }`), matching the migration's return shape and the `bulk_delete_tasks_atomic` entry's formatting convention.

## Out-of-scope work needed
None identified within restoreTask itself. Not investigated: whether any other trash-restore-adjacent code path (e.g. a bulk-restore action, if one exists elsewhere in the codebase) has the same multi-write-without-transaction issue — out of scope per this task's "touch only restoreTask" instruction.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Simplified the general two-neighbor `calculatePosition` formula to `coalesce(last_position, 0) + 1000` inside the SQL function, since restoreTask (both for the parent and for each cascaded child) only ever calls `calculatePosition(lastPosition, null)` — i.e. always "append to the end of the column," never a genuine between-two-cards insert. Confirmed this is algebraically identical to the original JS behavior for every call site in this function (empty column → 1000 = DEFAULT_POSITION; non-empty column → last + 1000 = prev + BOUNDARY_GAP), not an approximation.

## Notes for the next worker
- The pre-existing `tests/unit/fts-tasks.test.ts` failure (Supabase admin `createUser` call timing out in its `beforeAll` hook) is unrelated to this change — it reproduces on a clean environment issue (likely local Supabase/auth service availability during this run), not from anything touched here. Did not investigate further since it's out of scope for this task.
- No MCP tools were used for this task — it's a pure migration-file + application-code change with no live schema/policy introspection needed beyond reading the existing `bulk_delete_tasks_atomic` migration as a pattern reference.
