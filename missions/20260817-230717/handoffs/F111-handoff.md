# Handoff: F111 — start stop timer action

## Status
COMPLETE

## Assertions covered
AS-164: PASS — startTimer succeeds when the caller has no active timer; row lands in active_timers for the requested task.
AS-165: PASS — active_timers.user_id UNIQUE constraint (F109) plus start_timer_atomic's auto-stop-first logic mean a caller never has more than one active timer.
AS-166: PASS — start_timer_atomic (SECURITY DEFINER Postgres function) atomically stops any existing timer (logs it to time_entries, deletes the old active_timers row) then inserts the new one, all inside one transaction.
AS-167: PASS — stop_timer_atomic computes elapsed minutes server-side from the row's own started_at vs now(), inserts a time_entries row with billable=true, deletes the active_timers row; stopTimer() returns ok:false (not a throw) when no active timer exists.
AS-168: PASS — getActiveTimer() (lib/queries/time-entries.ts) reads the caller's active_timers row + joined task info via the RLS-respecting client; minutes computation in both RPCs uses now() from the DB, never a client-supplied timestamp.

## Files changed
supabase/migrations/20260818153433_create_stop_and_start_timer_rpc.sql
lib/supabase/database.types.ts (regenerated via `supabase gen types typescript`)
lib/actions/time-entries.ts (added startTimer, stopTimer)
lib/queries/time-entries.ts (new — getActiveTimer)
tests/integration/start-stop-timer.test.ts (new)

## Commands run
`supabase db push` (0)
`supabase gen types typescript --project-id ...` (0)
`npx tsc --noEmit` (0)
`npx eslint lib/actions/time-entries.ts lib/queries/time-entries.ts tests/integration/start-stop-timer.test.ts` (0)
`npx vitest run` (0) — 90 files / 480 tests passed, including the 6 new F111 tests
`npm run build` (0)

## Decisions made
- Followed the Clarified implementation's explicit steer toward the F094/F095/F102 SECURITY DEFINER RPC pattern (create_workspace_with_owner) instead of three sequential app-layer round trips, so a crash mid auto-stop-then-start sequence can never leave two active timers or lose the old timer's elapsed time. Two functions: `start_timer_atomic(p_task_id)` and `stop_timer_atomic()`, both `security definer`, both source the caller's id from `auth.uid()` (never an argument) and are invoked through the request-scoped (session-carrying) client, not the admin client — the admin/service-role client has no `auth.uid()`, so it cannot be used to call these RPCs.
- Elapsed minutes formula: `greatest(1, round(extract(epoch from (now() - started_at)) / 60.0))` — matches the spec's "round to nearest minute with a 1-minute floor," computed inside the Postgres function so it's immune to client clock skew/tampering (AS-167/AS-168).
- Membership re-check (task -> project -> workspace lookup + requireActiveMembership) happens in startTimer() in application code before calling start_timer_atomic, mirroring logTimeEntry's (F110) defense-in-depth convention — the RPC itself doesn't re-derive workspace membership, it trusts the FK on task_id plus the caller-scoped session.
- stopTimer() does not re-check membership before calling stop_timer_atomic() — there's nothing to check against without first knowing which task the active timer belongs to, and the RPC only ever touches the caller's own active_timers row (scoped by auth.uid()), so there's no cross-workspace surface to defend.
- Test file signs in a real throwaway user via signInWithPassword (rather than only mocking auth.getUser() like log-time-entry.test.ts) because start_timer_atomic/stop_timer_atomic are SECURITY DEFINER functions that read auth.uid() from the request's JWT — a mocked getUser() return value doesn't produce a real session for supabase.rpc() to carry.

## Out-of-scope work needed
- No UI wiring yet (start/stop buttons, live-updating elapsed-time display) — F111's scope was the action/query layer only, per the feature spec's Files section.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: stopTimer() returns entryDate as current_date (the day the stop happens) rather than the day the timer started, consistent with logTimeEntry's time_entries.entry_date semantics and with how a timer that spans midnight would reasonably be logged (against completion day). Spec did not address multi-day timers explicitly.

## Notes for the next worker
- The two RPCs are in `supabase/migrations/20260818153433_create_stop_and_start_timer_rpc.sql`; `lib/supabase/database.types.ts` was regenerated afterward via the Supabase CLI (`supabase gen types typescript --project-id <ref>`) — if a future migration touches `active_timers`/`time_entries`/these functions, regenerate types again before typechecking.
- `getActiveTimer()` lives in `lib/queries/time-entries.ts` (not a Server Action) per the spec, and uses the request-scoped client so RLS (not an admin bypass) is what scopes it to the caller's own row.
