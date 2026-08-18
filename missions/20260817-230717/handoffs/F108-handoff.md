# Handoff: F108 — db schema time entries

## Status
COMPLETE

## Assertions covered
AS-161: PASS — workspace member can INSERT a manual time entry (minutes, billable, note) and SELECT it; verified in tests/integration/rls-time-entries.test.ts.
AS-162: PASS — direct insert of minutes = 0 and minutes = -15 both rejected by the `time_entries_minutes_positive` CHECK constraint at the database level, bypassing app-level validation entirely.
AS-163: PASS — non-member cannot INSERT claiming a task_id in a workspace they don't belong to, gets zero rows on direct select, join-style select, and full list query by task_id, even with a valid session in a different workspace.

## Files changed
supabase/migrations/20260818151501_create_time_entries.sql
lib/supabase/database.types.ts (regenerated via `supabase gen types typescript`)
tests/integration/rls-time-entries.test.ts

## Commands run
`supabase migration new create_time_entries` (0)
`supabase db push` (0)
`supabase gen types typescript --project-id qcipqonnqajmazdbysow > lib/supabase/database.types.ts` (0)
`npx tsc --noEmit` (0)
`npm run lint` (0 — 1 pre-existing unrelated warning in lib/queries/search.ts, no errors)
`npx vitest run tests/integration/rls-time-entries.test.ts` (0 — 9/9 passed)
`npm run build` (0)
`npm test` (0 — 87 files / 460 tests passed, full suite)

## Decisions made
- Reused `public.is_task_workspace_member(task_id)` (defined in F058's `20260818040214_create_comments.sql`) rather than duplicating a new helper function — the join shape (task -> project -> workspace_members) is identical to comments', so a second copy would be pure duplication.
- No general UPDATE/DELETE RLS policy added at this layer, per the feature spec's explicit instruction. AS-169/AS-170 (author can edit own entry; author-or-admin can delete) belong to F112, which should add an author-or-admin policy mirroring F061's `can_modify_comment` pattern (a new `can_modify_time_entry(target_entry_id uuid)` SECURITY DEFINER helper, or a straight reuse of the same query shape against `time_entries`). Until F112 lands, absence of UPDATE/DELETE policies denies those operations by default under RLS — same convention as comments between F058 and F061 — so there is no window where an unrestricted policy would over-grant access.
- `minutes` stored as a plain `integer` (not `interval`), per the spec's Clarified implementation note — both manual entry and future timer-stop (F109+) compute a plain integer minute count before writing the row.
- `updated_at` wired to the existing `set_updated_at()` trigger function (established in F033/F058's migrations), not a new trigger function.
- Did not create an `active_timers` table in this migration — F108's Draft scope and Files section only mention `time_entries`; `active_timers` belongs to the live-timer features (F109+, AS-164–168).

## Out-of-scope work needed
- F112 (or equivalent): author-scoped UPDATE policy (AS-169) and author-or-admin-scoped DELETE policy (AS-170) on `time_entries`, mirroring F061's `can_modify_comment` pattern.
- Live timer support (AS-164–168) needs a separate `active_timers` table/migration — not created here, out of F108's Draft scope.
- Task/project/person-level time aggregates (AS-171–174) need their own RPCs/views, following the pattern of the existing `rpc_priority_counts` / `rpc_status_counts` migrations.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to reuse `is_task_workspace_member` instead of introducing a `time_entries`-specific helper function, since the spec explicitly said "reuse the is_task_workspace_member helper from F058, or an equivalent" and the join shape is identical — no equivalent was needed.

## Notes for the next worker
- The migration file is `supabase/migrations/20260818151501_create_time_entries.sql`. It was applied to the linked remote Supabase project via `supabase db push`.
- `lib/supabase/database.types.ts` was regenerated after the push and now includes `time_entries` types (Row/Insert/Update + the FK relationship to `tasks`).
- The RLS test file `tests/integration/rls-time-entries.test.ts` closely mirrors `tests/integration/rls-comments.test.ts` (F058) in structure: workspace A / workspace B / member-A / non-member setup via the secret-key admin client, then assertions run through publishable-key clients signed in as each user. Cleanup runs in `afterAll`.
- `npm test` at repo root only runs vitest when `tests/unit` has files; the actual comprehensive suite (87 files, 460 tests, including all `tests/integration/*.test.ts`) is what `npx vitest run` picks up — this ran clean.
