# F009: migration drop task id

**Milestone:** M2 — Database
**Estimated worker time:** 30 minutes
**Depends on:** F008

## Assertion IDs covered
- AS-038: The `calendar_blocks` table has no `task_id` column.
- AS-039: Every calendar block that existed before the `task_id` removal still exists afterwards.
- AS-041: Deleting a task deletes no calendar block.

## Draft scope
- Drop calendar_blocks_task_id_idx, then the task_id column.
- No row is deleted; only the column goes.
- Header comment records that the task link was removed by product decision 2.5(c).

## Files (approximate)
- `supabase/migrations/<ts>_calendar_blocks_drop_task_id.sql`

## Notes for clarification
Removing the column is also what removes the task->block delete cascade (AS-041). MCP at run: Supabase MCP.
