# Handoff: F163 — task_watchers table + RLS

## Status
COMPLETE

## Assertions covered
AS-293: PASS — `tests/integration/rls-task-watchers.test.ts` — "AS-293: a user can watch a task they are not assigned to, using only their own session" inserts a watcher row as member B (not the task's assignee) using memberBClient (a real signed-in publishable-key session, not the admin client), then re-reads it through the same session to prove persistence.

## Files changed
supabase/migrations/20260822040000_task_watchers.sql
tests/integration/rls-task-watchers.test.ts
lib/supabase/database.types.ts (task_watchers Row/Insert/Update/Relationships block — see Decisions made re: how this landed)

## Commands run
`supabase migration list --linked` (0) — pre-flight connectivity check, succeeded on first try this session
`supabase db push --linked --dry-run` (0) — reported "Remote database is up to date" (misleading — see Decisions made)
`supabase gen types typescript --linked` (0) — used to confirm task_watchers did NOT exist live, then again after push to regenerate types
`supabase migration repair --status reverted 20260821222722` (0)
`supabase db push --linked` (0) — applied `20260822040000_task_watchers.sql`
`npx vitest run tests/integration/rls-task-watchers.test.ts` (0) — 7/7 passed
`npm run test` (0 under serial run; the first concurrent run showed 34 failures but ALL were `Request rate limit reached` from Supabase auth sign-in, none in my test file — see Verification notes)
`npx tsc --noEmit` (0)
`npx eslint .` (0) — 2 pre-existing warnings in unrelated files, 0 errors

## Decisions made
- **RLS shape for self-insert vs. F164's future auto-add path**: SELECT is scoped through `public.is_task_visible_to(task_id)` (same helper as F159 task_assignees and F132 checklist_items). INSERT and DELETE additionally require `user_id = auth.uid()` — i.e. a signed-in user may only create or remove *their own* watcher row via RLS. This intentionally does NOT provide a "watch on behalf of another user" path. Per the clarified spec's own note ("Should assignment auto-watch as well as commenting? Deciding here keeps F207's fan-out simple"), auto-watch-on-assign/comment is explicitly out of scope for F163 and is left for F164, which is expected to implement it as a SECURITY DEFINER trigger or via the service-role client rather than a relaxed RLS predicate on this table — keeping this feature's write surface exactly as narrow as AS-293 requires.
- **Ambiguity resolution** (spec's open question about auto-watch on assignment): resolved by doing nothing here — deferred entirely to F164, per the "simplest option, no second source of truth" default in the clarification.
- **Stale migration timestamp**: the migration file `20260821222722_task_watchers.sql` was found empty in the working tree (interrupted mid-write in a prior session) but `supabase migration list --linked` showed that timestamp already recorded as applied on the remote — almost certainly because a prior interrupted `supabase db push` ran with the empty file and succeeded as a no-op, which the CLI then tracked as "applied." Confirmed via `supabase gen types typescript --linked` that `task_watchers` did NOT actually exist live. Resolved by: (1) writing the real migration content, (2) renaming the file to a fresh timestamp `20260822040000_task_watchers.sql` so the CLI would treat it as new work, (3) running `supabase migration repair --status reverted 20260821222722` to clear the stale remote history entry for the old timestamp, (4) `supabase db push --linked`, which then applied cleanly. Re-verified post-push via `gen types` that the table now exists with the expected columns.
- **database.types.ts merge**: added only the new `task_watchers` block (Row/Insert/Update/Relationships), inserted alphabetically between `task_dependencies` and `tasks`, by diffing a freshly generated file against the working copy rather than overwriting the whole file — confirmed via `grep` that F159's `task_assignees` block and F166's `estimate_minutes` fields were both still present afterward. Note: by the time I went to commit, `git status` showed this file as clean (no diff vs. HEAD) — F166's commit `751ae4f` had already run `git add`/commit while my edit was sitting untracked in the working tree and absorbed it. I did not amend or touch that commit; I only committed my own two new files (migration + test) in a fresh F163 commit. Verified again after my own commit that `task_assignees`, `estimate_minutes`, and `task_watchers` are all still present together in the current file.

## Out-of-scope work needed
- F164 (auto-watch on assignment/comment): needs its own migration/trigger (or service-role write path) since this feature's RLS deliberately does not allow one user to write another user's watcher row.
- F231 ("tasks I watch" in My Tasks): can now query `task_watchers` filtered by `user_id`, using the `task_watchers_user_id_idx` index added in this migration; no reader code was added here (out of this feature's file scope).
- No Server Action was added for watch/unwatch (e.g. `lib/actions/tasks.ts`) — the feature spec's "Files (approximate)" list only names the migration and `database.types.ts`, so per scope-boundary rules I left the UI/action layer for whichever feature is scoped to build it (likely alongside F164 or a dedicated watch-toggle feature). AS-293 is proven at the RLS layer per the definition-of-done's "integration for... RLS" guidance.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Renamed the migration file from `20260821222722_task_watchers.sql` to `20260822040000_task_watchers.sql` and ran `supabase migration repair --status reverted 20260821222722` to work around a stale "applied" record left by a prior interrupted push of an empty file. No schema was ever actually created under the old timestamp (verified via `gen types` before repairing), so this is a rename/relabel of unpushed work, not a destructive operation on live data.

## Notes for the next worker
- MCP: Supabase MCP (`mcp__supabase__*`) was still "Pending approval" in this session (`claude mcp list`), so all schema work went through the Supabase CLI (`supabase db push` / `gen types` / `migration list` / `migration repair`) per the registry's fallback guidance — never blocked on MCP approval.
- Connectivity was fine this run (`supabase migration list --linked` returned promptly, well under the ~20s watch window) — no BLOCKED needed.
- If a future worker sees `supabase db push` report "Remote database is up to date" but a table you expect is missing, don't trust that message alone — cross-check with `supabase gen types typescript --linked` (grep for the table name) before assuming the migration is live. This session hit exactly that trap from a prior interrupted run.
