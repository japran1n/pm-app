# F111: start stop timer action

**Milestone:** M9 — Time tracking
**Estimated worker time:** 40 minutes
**Depends on:** F109, F110

## Assertion IDs covered
- AS-164, AS-165, AS-166, AS-167, AS-168

## Draft scope
- lib/actions/time-entries.ts: startTimer(taskId) — re-checks membership; if the caller already has an active_timers row (any task), first stop it (compute elapsed minutes = now - started_at, rounded to nearest minute with a 1-minute floor, insert a time_entries row with billable=true, delete the old active_timers row), THEN insert the new active_timers row for the requested task. This is the mechanism satisfying AS-166.
- stopTimer() — finds caller's active_timers row (if any), computes elapsed minutes, inserts a time_entries row (billable=true default), deletes the active_timers row. If no active timer exists, returns a clear ok:false rather than erroring.
- getActiveTimer() — a query (not necessarily a Server Action) returning the caller's current active_timers row + task info, used by the UI on mount to restore timer display state (AS-168).

## Files (approximate)
lib/actions/time-entries.ts (extend), lib/queries/time-entries.ts

## Clarified implementation
- Elapsed-time computation happens server-side (using the DB's started_at against now(), not the client's clock) to avoid clock-skew/manipulation issues.
- Auto-stop-then-start (AS-166) happens as two sequential operations within the same Server Action call, not two separate user-facing actions — the user experience is "click start on task B while task A's timer is running" → both effects happen from one click.

## Definition of done
- Integration tests: starting a timer with none active succeeds; starting a second timer auto-stops and logs the first (assert the resulting time_entries row's minutes are reasonable and the old active_timers row is gone); stopping with no active timer returns a clean error, not a crash.
