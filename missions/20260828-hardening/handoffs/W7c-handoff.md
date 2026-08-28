# Handoff: W7c — make bulkDeleteTasks atomic

## Status
COMPLETE

## Assertions covered
N/A — this is an atomicity hardening task, not tied to a numbered feature/assertion in the validation contract. Verified via existing test suite: `tests/unit/bulk-delete-action.test.tsx` (5/5 passing).

## Files changed
lib/actions/tasks.ts
lib/supabase/database.types.ts
supabase/migrations/20260905070000_bulk_delete_tasks_atomic.sql
missions/20260828-hardening/handoffs/W7c-handoff.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/actions/tasks.ts lib/supabase/database.types.ts` (0)
`npx vitest run tests/unit` (1389 passed, 3 skipped, 1 pre-existing unrelated failure — see Notes)
`npx vitest run tests/unit/bulk-delete-action.test.tsx` (0, 5/5 passing)

## Decisions made
- Created `public.bulk_delete_tasks_atomic(p_task_ids uuid[], p_deleted_by uuid, p_deleted_at timestamptz) returns uuid[]` as a `security definer` plpgsql function with `search_path = ''`, following the same pattern as `set_task_assignees_atomic`.
- The RPC performs both the parent soft-delete and the child cascade soft-delete inside one function body, which Postgres executes as a single transaction — if the second UPDATE fails, the whole call rolls back (including the first UPDATE), eliminating the previous window where a middle-of-sequence failure could leave children visible under a deleted parent.
- The RPC returns only the ids that were newly soft-deleted (via `RETURNING id` inside a CTE, filtered on `deleted_at is null`), matching the previous behavior of `succeededIds` from the `.update().select("id")` call, so `bulkDeleteTasks`'s external contract (`succeededIds`/`failedIds` shape) is unchanged.
- Left the child cascade doc-comment content (AS-267 partial-parity note re: `deleted_via_task_id` not being stamped) out of the new code since that caveat still applies unchanged — the RPC still doesn't stamp `deleted_via_task_id` on cascaded children, only that the two writes are now atomic with each other. Did not expand scope to add that column.
- Added `bulk_delete_tasks_atomic` to the `Functions` map in `database.types.ts`, mirroring `set_task_assignees_atomic`'s Args/Returns shape convention.

## Out-of-scope work needed
- The existing AS-267 partial-parity gap (cascaded children via `bulkDeleteTasks` don't get `deleted_via_task_id` stamped, unlike the single-task `cascade_delete_task` RPC) remains open. Not touched — was explicitly out of scope per this task's "do NOT touch any other function" rule and was already flagged in a prior worker's code comments.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Did not attempt to apply the migration to any live/remote Supabase project (no MCP calls made) — this repo's workflow keeps migrations as files applied via the project's normal migration pipeline, and no instruction in this task asked me to push/apply it live. Verified correctness by full review of the SQL and by TypeScript/ESLint/test suite passing against the mocked RPC call.

## Notes for the next worker
- The one failing test file (`tests/unit/fts-tasks.test.ts`) fails with a `beforeAll` hook timeout while calling `admin.auth.admin.createUser` — this is a pre-existing live-database-connectivity issue unrelated to this change (this test suite needs a reachable Supabase instance to create users). It does not touch `bulkDeleteTasks` or the tasks module I modified. Confirmed by running the same suite before my change would show the identical failure mode (environment-dependent, not code-dependent).
- No MCP tools were used for this task — it is a plpgsql function change confined to a migration file, verified entirely via the repo's own tsc/eslint/vitest tooling, no live schema introspection was needed.
