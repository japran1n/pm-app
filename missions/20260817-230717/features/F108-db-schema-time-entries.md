# F108: db schema time entries

**Milestone:** M9 — Time tracking
**Estimated worker time:** 30 minutes
**Depends on:** F034 (tasks table + RLS pattern)

## Assertion IDs covered
- AS-161, AS-162, AS-163

## Draft scope
- Migration: `time_entries` table (id uuid PK, task_id FK to tasks not null, user_id FK to auth.users not null, minutes integer not null CHECK (minutes > 0), billable boolean not null default true, note text nullable, entry_date date not null default current_date, created_at timestamptz default now(), updated_at timestamptz default now() via set_updated_at trigger).
- RLS: same tasks->projects->workspace_members join pattern as comments (F058). SELECT/INSERT for active workspace members; UPDATE/DELETE restricted at the action layer (F112), not necessarily at the RLS layer alone — but RLS should still scope by workspace membership as the baseline.
- Index task_id and user_id.

## Files (approximate)
supabase/migrations/ (new)

## Clarified implementation
- User decisions (from strategic planning round): both manual entry and live timer supported; billable/non-billable flag required.
- minutes stored as an integer (not a duration/interval type) for simplicity — both manual entry and timer-stop compute a plain integer minute count.
- CHECK (minutes > 0) enforces AS-162 at the database level, not just Zod.

## Definition of done
- Migration applies cleanly via `supabase db push`.
- A real RLS integration test (mirroring F058's rls-comments.test.ts style): workspace member can insert/select; non-member gets zero rows including via join.
