# Handoff: F028 — Migration — add task_assignees to realtime publication

## Status
COMPLETE

## Assertions covered
AS-015: PASS — migration adds `task_assignees` to the `supabase_realtime` publication, matching the exact idempotent pattern used for `tasks` (verified by reading `20260818040000_realtime_tasks_publication.sql`).
AS-016: PASS — same migration; publication membership means Postgres now emits logical-replication events for INSERT/DELETE on `task_assignees`, unblocking F025's client-side subscription.
AS-017: PASS — migration is idempotent/safe to re-run via the `pg_publication_tables` existence guard, same as the `tasks` publication migration.
AS-018: PASS — `task_assignees` switched to `REPLICA IDENTITY FULL` so DELETE events (un-assign) carry the complete old row (including `user_id`), not just a subset — required since default replica identity for DELETE only reliably guarantees the full old row when the table has FULL identity; the table's composite PK does include `user_id`, but FULL identity was applied per the spec's explicit callout to guarantee old-row data isn't lost on DELETE.

## Files changed
supabase/migrations/20260831000001_task_assignees_realtime_publication.sql

## Commands run
`npm run lint` (0)
`npx tsc --noEmit` (0)

## Decisions made
- Followed the exact pattern from `20260818040000_realtime_tasks_publication.sql` (pg_publication_tables existence check, `alter publication supabase_realtime add table public.task_assignees;`) for consistency and idempotency.
- Added `alter table public.task_assignees replica identity full;` per the feature spec's explicit instruction to check whether task_assignees needs full replica identity for DELETE events to carry `user_id` — set to FULL to make DELETE payloads self-describing (not just PK columns) for the un-assign realtime flow.
- Did not attempt to apply the migration to a live/local Supabase instance (no local Supabase stack was running in this environment); the migration file itself is the deliverable per the spec, which explicitly says not to block on this.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Did not run `supabase db push` since no local Supabase instance was detected running in this environment; per the spec this is optional ("do NOT block on this — the migration file is the deliverable").

## Notes for the next worker
No MCP usage required for this feature (pure SQL migration file, no live-state introspection needed since the pattern was fully verifiable by reading the existing `tasks` publication migration and the `task_assignees` table migration in-repo).
