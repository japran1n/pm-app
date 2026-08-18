# Handoff: F034 — db schema rls tasks

## Status
COMPLETE

## Assertions covered
AS-062: PASS — non-member gets zero rows on direct select, update, and a join-style query via project_id; anon key with no session gets zero rows; non-member INSERT with a foreign project_id is rejected. Member can SELECT/INSERT/UPDATE. Verified in tests/integration/rls-tasks.test.ts (9/9 passing) against the real linked Supabase project.

## Files changed
supabase/migrations/20260818013805_rls_tasks.sql
tests/integration/rls-tasks.test.ts
missions/20260817-230717/handoffs/F034-handoff.md

## Commands run
`supabase migration new rls_tasks` (0)
`supabase db push` (0)
`npx vitest run tests/integration/rls-tasks.test.ts` (0)
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npx vitest run` (0) — 31 files, 171 tests passed
`npm run build` (0)

## Decisions made
- Added a new SECURITY DEFINER helper `public.is_project_workspace_member(project_id)` rather than reusing F012's `is_active_workspace_member` directly, because tasks is one join level deeper (tasks -> projects -> workspace_members) and `projects.id` isn't a `workspace_id`. The helper joins `projects` to `workspace_members` on `workspace_id` and filters by `auth.uid()` + `status = 'active'`, mirroring the shape and grants of the F012 helper.
- Followed the F025 policy shape exactly: SELECT/UPDATE filter `deleted_at is null`; INSERT/UPDATE `with check` re-validates `project_id` against the helper so a member can't smuggle a task into a project outside their workspace; no DELETE policy (soft-delete only, per tech-decisions.md), which denies hard DELETE by default under RLS.
- No FORCE ROW LEVEL SECURITY, same rationale as F012/F025 — privileged server writes go through the secret key.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — implementation followed the clarified spec and the established F025/F012 pattern directly)

## Notes for the next worker
- The new helper is `public.is_project_workspace_member(uuid)` in `supabase/migrations/20260818013805_rls_tasks.sql`. Any future table that hangs off `tasks` (e.g. comments, attachments) one join level further should extend this pattern rather than repeating the two/three-level join inline.
- Test file mirrors `tests/integration/rls-projects.test.ts` (F025) structure: skips if Supabase creds aren't in `.env`, uses the secret-key admin client to seed workspace A/B, a member, and a non-member, then asserts via two real `authenticated` sessions (memberAClient, nonMemberClient) plus one anon client.
- `supabase db push` applied cleanly against the linked project (`qcipqonnqajmazdbysow`); no down-migration written since `tasks` is a brand-new table (F033, same milestone).
