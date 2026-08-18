# F109: db schema active timers

**Milestone:** M9 — Time tracking
**Estimated worker time:** 25 minutes
**Depends on:** F108

## Assertion IDs covered
- AS-164, AS-165, AS-168

## Draft scope
- Migration: `active_timers` table (id uuid PK, task_id FK to tasks not null, user_id FK to auth.users not null unique — the UNIQUE constraint on user_id is what enforces AS-165's "at most one active timer per user" at the database level, not just app logic, started_at timestamptz not null default now()).
- RLS: same workspace-scoped pattern.
- This table only ever holds 0 or 1 row per user (deleted when the timer stops, converted into a time_entries row by F111). Server-persisted (not client localStorage) satisfies AS-168 — a reload/new tab reads this table, not browser state.

## Files (approximate)
supabase/migrations/ (new)

## Clarified implementation
- UNIQUE constraint on user_id (not (user_id, task_id)) is the mechanism enforcing "one timer at a time across the whole workspace" — a second INSERT for the same user fails at the DB level, which F111's start-timer action must handle by stopping the old one first (per AS-166), not by letting the constraint violation bubble up as an error.

## Definition of done
- Migration applies cleanly.
- A test proving the UNIQUE constraint genuinely rejects a second concurrent active_timers row for the same user (direct insert attempt, bypassing the action layer).
