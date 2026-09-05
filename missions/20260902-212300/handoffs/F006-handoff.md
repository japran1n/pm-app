# Handoff: F006 — Add `client_requests` to the realtime publication

## Status
COMPLETE

## Assertions covered
AS-017: PASS — Verified live via Supabase Management API query against
`pg_publication_tables`: `client_requests` is now a member of the
`supabase_realtime` publication alongside channel_members, channels,
comment_reactions, comments, message_reactions, messages, notifications,
project_statuses, task_assignees, tasks.

## Files changed
supabase/migrations/20260905120000_client_requests_realtime_publication.sql

## Commands run
`npm run db:apply -- supabase/migrations/20260905120000_client_requests_realtime_publication.sql` (0)
`npx supabase migration list --linked` (0) — 20260905120000 shows local=remote, no drift
`npx tsc --noEmit` (nonzero, but only pre-existing failures unrelated to this feature: tests/unit/check-migration-drift.test.ts NODE_ENV typing and tests/unit/f008-my-tasks-realtime.test.ts channelObject — both predate this change and are outside this feature's scope/files)
`npm run lint` (0) — 0 errors, 15 pre-existing warnings unrelated to this feature
`npm test -- --run` (full suite ran; failures observed were in unrelated live-DB integration suites: tests/integration/checklist-actions.test.ts, f228-saved-view-actions.test.ts, rls-saved-views.test.ts, f229-saved-views-ui.test.ts, f221-board-custom-columns.test.ts — none reference client_requests, realtime publications, or files this feature touches; consistent with cross-mission concurrent workers mutating the same live Supabase project during the test run)
Management API query to `pg_publication_tables` via `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` from `.env` (no credential values printed)

## Decisions made
- Modelled the migration exactly on `20260831000001_task_assignees_realtime_publication.sql`'s idempotent `do $$ ... end $$` guard pattern using `pg_publication_tables` existence check.
- Deliberately did NOT touch replica identity on `client_requests`, per the spec's explicit instruction referencing F042's revert of a similar change on `task_assignees`. Publication membership only.
- No dedicated test file was added: this feature is a pure infrastructure migration with no application code. AS-017 was verified directly against the live project via the Supabase Management API (equivalent evidence to a live-DB test, but run as a one-off orchestrator-style verification per the spec's own instruction to "confirm membership by re-querying `pg_publication_tables`"), consistent with the DoD requirement that no new test require a live Supabase connection.

## Out-of-scope work needed
None identified for this feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose timestamp 20260905120000 (one hour after the prior latest migration 20260905110000) to keep migrations sorted chronologically per repo convention.

## Notes for the next worker
- Live publication membership after this migration (queried via Management API `/v1/projects/<ref>/database/query`): channel_members, channels, client_requests, comment_reactions, comments, message_reactions, messages, notifications, project_statuses, task_assignees, tasks.
- The full `npm test` run in this working tree also exercises many other in-flight features' integration tests against the same live Supabase project (concurrent missions/workers). Failures seen (checklist actions, saved views, board custom columns) are unrelated to client_requests/realtime and were not introduced by this migration — they touch entirely different tables and files not in this feature's scope.
