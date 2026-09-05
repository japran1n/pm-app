# Handoff: F042 — Fix AS-018: revert task_assignees replica identity full via new migration

## Status
COMPLETE

## Assertions covered
AS-018: PASS — new migration `20260831000002_task_assignees_replica_identity_default.sql` sets `alter table public.task_assignees replica identity default`, reverting the FULL setting from the prior migration without modifying it. Verified by reading the file and confirming SQL syntax matches the pattern used elsewhere in the migrations directory (e.g. `20260823080000_fix_comment_reactions_soft_delete_and_scoping.sql` uses the same `replica identity` statement pattern).

## Files changed
supabase/migrations/20260831000002_task_assignees_replica_identity_default.sql

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 13 pre-existing warnings unrelated to this change)
`git commit` (0)

## Decisions made
- Left `supabase/migrations/20260831000001_task_assignees_realtime_publication.sql` untouched per the immutability rule for existing migrations; created a new append-only migration instead.
- Searched the test suite (`grep -rl "task_assignees" tests/`, `grep -rl "replica identity" tests/`) and found no existing test that asserts `REPLICA IDENTITY FULL` for `task_assignees`, so no test file needed updating. The only replica-identity references in `tests/` are for unrelated calendar realtime files (`f027-calendar-realtime-wiring.test.tsx`, `f009-calendar-realtime-subscription.test.ts`), which don't reference `task_assignees`.
- This is a SQL-only migration with no application code change, so no new unit/integration test was written — the assertion is verified by static SQL content, consistent with how the original migration (20260831000001) was reviewed by scrutiny rather than exercised by an automated test.

## Out-of-scope work needed
None identified. This migration is self-contained.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Did not modify any test file since no test in the repo asserts on `REPLICA IDENTITY FULL`/`DEFAULT` for `task_assignees`; verified via grep across `tests/` before concluding no update was needed.

## Notes for the next worker
- The new migration must be applied to the live Supabase project (via `supabase db push` or the project's normal migration deploy flow) for the fix to take effect remotely — this worker did not have Supabase MCP write access invoked for this fix since it's a pure SQL file change matching the existing repo pattern (migrations are applied by the deploy pipeline, not by workers directly, per other F0xx migration handoffs in this mission).
- `lib/tasks/use-my-tasks-realtime.ts` (referenced in the feature spec) already filters DELETE events by `user_id`, which remains present under `REPLICA IDENTITY DEFAULT` since `user_id` is part of the composite primary key `(task_id, user_id)`.
