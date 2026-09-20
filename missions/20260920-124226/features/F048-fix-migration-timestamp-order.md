# F048: fix migration timestamp ordering (M2 blocker)

**Milestone:** M2 follow-up (M2-scrutiny-1 FU-D)
**Estimated worker time:** 20 minutes
**Depends on:** F008, F009

## Problem
Our two migrations are timestamped 20260920113500/01, but `supabase/migrations/20261107010000_calendar_blocks.sql`
creates the calendar_blocks table (with task_id). On a fresh stand-up, our migrations run BEFORE
the table creation, which would fail or be overwritten.

The migrations are ALREADY APPLIED to the remote DB (F010 ran db:apply). The filenames just need
to sort after 20261128010000_sitemaps.sql (the last migration before our additions).

## Fix
1. Rename the two files to sort after everything else:
   - 20260920113500 → 20261128010001_calendar_blocks_workspace_wide_select.sql
   - 20260920113501 → 20261128010002_calendar_blocks_drop_task_id.sql

2. Since the migrations are already applied remotely, we need to update the Supabase migration
   tracking table. Run `npm run db:apply` to handle this, or use the Supabase MCP to execute:
   ```sql
   -- Update migration tracking from old name to new name
   UPDATE supabase_migrations.schema_migrations 
   SET version = '20261128010001'
   WHERE version = '20260920113500';
   UPDATE supabase_migrations.schema_migrations
   SET version = '20261128010002' 
   WHERE version = '20260920113501';
   ```
   Then run `npm run migrations:check` to verify no drift.

3. Make both SQL files idempotent with `if exists` / `if not exists` guards (already have them).
