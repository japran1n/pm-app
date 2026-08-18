# Handoff: F058 — db schema comments

## Status
COMPLETE

## Assertions covered
AS-104: PASS — a user viewing a task in one workspace cannot see comments belonging to a task in a different workspace, even via direct API access. Verified in `tests/integration/rls-comments.test.ts` (8/8 passing) against the real linked Supabase project: non-member gets zero rows on direct select, a join-style select via `task_id`, and a full list query scoped to `task_id`; non-member INSERT with a foreign `task_id` is rejected; anon key with no session gets zero rows. Member can SELECT/INSERT. Also covers the empty-comment-after-trim CHECK constraint (AS-095's DB-level backstop, incidental to this feature's scope).

## Files changed
supabase/migrations/20260818040214_create_comments.sql
lib/supabase/database.types.ts
tests/integration/rls-comments.test.ts
missions/20260817-230717/handoffs/F058-handoff.md

## Commands run
`supabase migration new create_comments` (0)
`supabase db push` (0)
`supabase gen types typescript --project-id qcipqonnqajmazdbysow` (0)
`npx vitest run tests/integration/rls-comments.test.ts` (0) — 8/8 passing
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npx vitest run` (0) — 57 files, 316 tests passed
`npm run build` (0)

## Decisions made
- Combined the schema and RLS in a single migration file rather than a separate follow-up, since both the table and its policies are small and this feature (unlike F033/F034) is scoped as one unit covering AS-104 alone. Documented this choice in the migration's header comment.
- Added a new SECURITY DEFINER helper `public.is_task_workspace_member(task_id)`, mirroring F034's `is_project_workspace_member(project_id)` shape and grants, joining one level deeper (comments -> tasks -> projects -> workspace_members) since `tasks.id` isn't a `workspace_id` and comments hang off tasks, not projects directly.
- `text` gets an explicit `btrim(text) <> ''` CHECK constraint from the start, per F100's lesson (already applied by F033 to `tasks.title`) — a bare `not null` doesn't reject empty or whitespace-only strings. This also gives AS-095 (empty comment cannot be submitted) a DB-level backstop, though the app-layer enforcement is out of scope for this feature.
- No UPDATE policy: comment soft-delete authorization (author-or-admin, AS-098/AS-099/AS-100) is explicitly out of scope per this feature's spec ("comments are soft-deleted only, per F061's future scope") — adding an unrestricted UPDATE policy now would let any member edit/soft-delete any comment's row, which is a wrong-shaped permission for a future feature to inherit. Documented in the migration comments so F061 knows to add a narrowly-scoped UPDATE policy rather than assuming one already exists.
- No DELETE policy: comments are soft-delete only, same rationale as tasks/projects — absence of a DELETE policy denies hard DELETE by default under RLS.
- Test file's non-member also holds active membership in a second workspace (workspace B), not just an unaffiliated session, matching F034's non-member-with-a-valid-session-elsewhere setup, and matching AS-104's exact wording ("even via direct API access").

## Out-of-scope work needed
- F061 (or whichever future feature owns comment deletion/soft-delete UI) needs to add an UPDATE policy on `comments` scoped to `(user_id = auth.uid() OR workspace admin/owner) AND public.is_task_workspace_member(task_id)`, covering AS-098/AS-099/AS-100. Not added here — deliberately left absent per this feature's scope note.
- App-layer Server Action for creating/reading comments (AS-094–AS-103) is not part of this feature; only the schema + RLS (AS-104) was in scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: combined schema + RLS into one migration file instead of two, since the spec explicitly left this choice to the worker ("In the SAME migration or a follow-up migration, your call, document it"). Chose one file because the table is small and both concerns fit cleanly in a single, well-commented migration, consistent with F025's projects migration shape but distinct from F033/F034's tasks split (tasks/RLS were split because a project_name-blank-constraint migration landed in between).

## Notes for the next worker
- The new helper is `public.is_task_workspace_member(uuid)` in `supabase/migrations/20260818040214_create_comments.sql`. Any future table hanging off `comments` one join level further (none currently planned) should extend this pattern.
- Test file mirrors `tests/integration/rls-tasks.test.ts` (F034) structure: skips if Supabase creds aren't in `.env`, uses the secret-key admin client to seed workspace A/B, a project, a task, a member, and a non-member (with their own membership in workspace B), then asserts via two real `authenticated` sessions (memberAClient, nonMemberClient) plus one anon client.
- `supabase db push` applied cleanly against the linked project (`qcipqonnqajmazdbysow`); no down-migration written since `comments` is a brand-new table.
- `lib/supabase/database.types.ts` was regenerated via `supabase gen types typescript --project-id qcipqonnqajmazdbysow` and now includes the `comments` table types.
