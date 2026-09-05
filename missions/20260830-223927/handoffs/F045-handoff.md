# Handoff: F045 — Fix SQL syntax error (reserved keyword `position`) in restore_task_atomic migration

## Status
COMPLETE

## Assertions covered
none (infrastructure fix)

## Files changed
supabase/migrations/20260905080000_restore_task_atomic.sql

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Quoted every use of `position` as a column name with double quotes (`"position"`) because `position` is a PostgreSQL reserved keyword (used in the `SUBSTRING(... FROM ... FOR ...)` / window-function `OVER (... POSITION ...)` grammar) and cannot appear unquoted as a column identifier in a `RETURNS TABLE (...)` declaration or in `SELECT`/`ORDER BY`/`UPDATE SET` clauses that reference it by name.
- Left all other identifiers (`status`, `project_id`, `id`, `status_was_reset`, etc.) unquoted since none of them are reserved keywords.
- No function logic was changed — only quoting of the identifier in: the `RETURNS TABLE` clause, two `SELECT ... INTO` / `ORDER BY` lookups (parent and child), and two `UPDATE ... SET` clauses (parent and child).

## Out-of-scope work needed
None identified. This was a scoped syntax fix to an existing migration file; the migration was not applied against a live database as part of this task (no Supabase MCP write-verification requested/available in scope for this fix).

## Blockers


## Autonomous decisions


## Notes for the next worker
The original syntax error (`ERROR: syntax error at or near "position"`) would have surfaced only when this migration is actually applied to a PostgreSQL instance (e.g., via `supabase db push` or the Supabase MCP migration apply flow), since `npx tsc --noEmit` and `npm run lint` do not parse embedded SQL. If a future worker applies migrations via Supabase MCP, they should re-verify this specific migration applies cleanly and that `restore_task_atomic` returns the `"position"` column correctly.
