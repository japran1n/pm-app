# Handoff: F109 — db schema active timers

## Status
COMPLETE

## Assertions covered
AS-164: PASS — a workspace member can INSERT an active timer on a task in their workspace (RLS allows it; verified insert is rejected only by the auth.users FK on a bogus user_id, not by RLS), and can SELECT it back afterward. Verified in tests/integration/rls-active-timers.test.ts.
AS-165: PASS — a direct second INSERT for the same user_id (different task_id), attempted both via the admin client and via the member's own publishable-key session, is rejected with Postgres error code 23505 (unique_violation) on the `active_timers_user_id_key` UNIQUE constraint. This is a raw insert with no start-timer action logic in between, proving the DB-level mechanism AS-165 depends on, independent of any future "stop the previous timer first" app logic (AS-166).
AS-168: PASS — the active timer row is read back via SELECT from a different (server-side) client, proving the running state lives in Postgres, not browser/client state — a reload or new tab re-reads this table.

## Files changed
supabase/migrations/20260818151845_create_active_timers.sql
lib/supabase/database.types.ts (regenerated via `supabase gen types typescript`)
tests/integration/rls-active-timers.test.ts

## Commands run
`supabase migration new create_active_timers` (0)
`supabase db push` (0)
`supabase gen types typescript --project-id qcipqonnqajmazdbysow > lib/supabase/database.types.ts` (0)
`npx vitest run tests/integration/rls-active-timers.test.ts` (0 — 9/9 passed)
`npx tsc --noEmit` (0)
`npm run lint` (0 — 1 pre-existing unrelated warning in lib/queries/search.ts, no errors)
`npm run build` (0)
`npx vitest run` (0 — 88 files / 469 tests passed, full suite, after allowing a brief cooldown between full-suite runs — see Notes)
`npm test` (0 — 88 files / 469 tests passed)

## Decisions made
- UNIQUE constraint placed directly on `user_id` (not `(user_id, task_id)`), per the spec's explicit Clarified implementation — this is what makes "one timer at a time across the whole workspace" (not per-task) hold at the DB level.
- Reused `public.is_task_workspace_member(task_id)` for SELECT/INSERT/DELETE policies, same as F108's `time_entries` and F058's `comments` — identical join shape (task -> project -> workspace_members), no new helper needed.
- Added a DELETE policy (`active_timers_delete_active_members`, scoped the same as SELECT/INSERT) even though it's not one of this feature's three assigned assertions, because `active_timers` is explicitly a 0-or-1-row-per-user table that's deleted when a timer stops (per the feature spec's Draft scope) — without a DELETE policy the table would be non-functional once F111 tries to stop a timer, and adding it is within this migration's natural scope (schema + RLS for this table). No UPDATE policy was added since the spec's lifecycle is create-then-delete, not edit-in-place.
- Only a `task_id` index was added; the UNIQUE constraint on `user_id` already creates its own unique index, so a redundant plain index on `user_id` was skipped (documented in the migration).
- Test file seeds a second task (`taskA2Id`) in the same workspace specifically to prove the UNIQUE constraint blocks on `user_id` alone, not `(user_id, task_id)` — a same-workspace, different-task insert for the already-timing user still fails.

## Out-of-scope work needed
- F111 (start/stop timer Server Actions, AS-166/AS-167): must catch the 23505 unique_violation from this constraint and translate it into "stop the previous timer, log it as a time_entries row, then start the new one" rather than surfacing a raw DB error to the user.
- No RLS UPDATE policy exists on `active_timers` — not needed by any assertion in this feature; flag if a future feature needs to mutate a running timer in place (e.g. reassigning it to a different task) rather than delete+recreate.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Added the DELETE RLS policy proactively (scoped like SELECT/INSERT: any active workspace member of the timer's task) even though DELETE wasn't explicitly one of AS-164/AS-165/AS-168, because the feature spec's Draft scope states the row "is deleted when the timer stops" — omitting a DELETE policy would leave the table unusable for its stated lifecycle under RLS default-deny, and F111 would hit an unexplained permission wall. This mirrors the same reasoning F108 used when scoping SELECT/INSERT together as one unit.

## Notes for the next worker
- Migration file: `supabase/migrations/20260818151845_create_active_timers.sql`, applied to the linked remote Supabase project via `supabase db push`.
- `lib/supabase/database.types.ts` was regenerated and now includes `active_timers` types (Row/Insert/Update + FK relationship to `tasks`).
- The RLS/UNIQUE test file `tests/integration/rls-active-timers.test.ts` mirrors `tests/integration/rls-time-entries.test.ts` (F108) in structure. The AS-165 tests are the core of this feature: one direct admin-client insert and one direct member-session insert, both asserting Postgres error code `23505`.
- Observed transient flakiness when running the full `npx vitest run` suite twice in quick succession back-to-back (Supabase Auth's own signup/sign-in rate limiting on the many ephemeral test users the integration suite creates) — failures were in unrelated pre-existing tests (e.g. `workspace-members-list.test.ts`, `project-list.test.ts`), not in anything touched by this feature, and each failing file passed cleanly when re-run in isolation or after a short cooldown. Final full-suite and `npm test` runs both passed 88/88 files, 469/469 tests with a ~90s gap between consecutive full runs. This is pre-existing test-infra behavior, not introduced by F109 — worth flagging to the orchestrator if it recurs at milestone-boundary validator time.
