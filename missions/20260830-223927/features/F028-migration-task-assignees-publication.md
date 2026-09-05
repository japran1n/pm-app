# F028: Migration — add task_assignees to realtime publication

**Milestone:** M2
**Estimated worker time:** 15 min
**Depends on:** F025

## Assertion IDs covered
- AS-015, AS-016, AS-017, AS-018

## Root cause

`task_assignees` table was created in `supabase/migrations/20260822020000_task_assignees_table.sql` with no publication statement. F025 subscribed to it but Postgres never emits events for it. Compare: `20260818040000_realtime_tasks_publication.sql` shows the correct pattern.

## Fix

Create a new migration `supabase/migrations/20260831000001_task_assignees_realtime_publication.sql`:

```sql
-- Add task_assignees to the supabase_realtime publication so Postgres
-- emits logical-replication events for INSERT and DELETE on this table.
alter publication supabase_realtime add table task_assignees;
```

Check if the publication name is `supabase_realtime` by reading existing migrations. Use the same pattern as `20260818040000_realtime_tasks_publication.sql`.

Also apply this migration to the local Supabase instance if possible (run `supabase db push` or equivalent), but do NOT block on this — the migration file is the deliverable.

## Files
`supabase/migrations/20260831000001_task_assignees_realtime_publication.sql`

## Definition of done
- Migration file exists and follows the existing pattern
- `task_assignees` is added to the same publication as `tasks`
