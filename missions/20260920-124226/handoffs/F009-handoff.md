# Handoff: F009 — Migration: drop task_id from calendar_blocks

## Status
COMPLETE

## Assertions covered
AS-038: PASS — migration statement `alter table public.calendar_blocks drop column if exists task_id;` removes the column; file reviewed, syntax valid Postgres DDL.
AS-039: PASS — `drop column` only removes the column, not rows; no `delete`/`truncate` present, so existing block rows survive.
AS-041: PASS — dropping `task_id` (and its FK, which lived on that column) removes any on-delete-cascade tied to task deletion, since the column itself is the cascade source.

## Files changed
supabase/migrations/20260920113501_calendar_blocks_drop_task_id.sql

## Commands run
`git add supabase/migrations/20260920113501_calendar_blocks_drop_task_id.sql` (0)
`git commit -m "feat(F009): ..."` (0)

No test suite run — this feature is migration-file authorship only; migration is not applied per spec (F010 handles apply + live verification against the database).

## Decisions made
- Timestamp `20260920113501` chosen to sort immediately after F008's `20260920113500`, per explicit instruction.
- Included `drop index if exists calendar_blocks_task_id_idx;` before the column drop, matching the exact content block provided in the task instructions.
- Did not apply the migration to any live database (no Supabase MCP schema-apply call made) — spec explicitly reserves that for F010.

## Out-of-scope work needed
- F010 must apply this migration (and F008's) to the live Supabase project and verify via MCP (e.g. `list_tables`/`execute_sql`) that `calendar_blocks` no longer has `task_id`, that existing rows are intact, and that deleting a task no longer removes calendar_blocks rows.
- Any application code (Planner UI, API routes, types) that still references `calendar_blocks.task_id` will need to be updated in a separate feature — not touched here per scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the exact SQL content and file path given in the task instructions verbatim, since this feature's spec was to author the migration file only, not to design its contents.

## Notes for the next worker
- No MCP calls were made for this feature since it is filesystem-only (migration authoring, not applying).
- The migration is idempotent-safe (`if exists` on both the index drop and column drop) so re-running it against a database that already lacks these objects is a no-op.
