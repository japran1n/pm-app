# F048 clarification

## Q1: The migrations are already applied to the remote DB - how do we handle renaming?
A: Rename the files locally AND update the supabase_migrations.schema_migrations tracking table via the Supabase MCP to match the new filenames. This ensures `migrations:check` sees no drift.

## Q2: What timestamps should we use for the renamed migrations?
A: 20261128010001 (workspace-wide select) and 20261128010002 (drop task_id). These sort after 20261128010000_sitemaps.sql, the last migration before ours.

## Q3: Is it safe to update the migration tracking table directly?
A: Yes. The UPDATE only changes the version/filename that Supabase uses to track "this migration has been run". The SQL in the migration files stays the same.

## Q4: What SQL do we run to update the tracking?
```sql
UPDATE supabase_migrations.schema_migrations 
SET version = '20261128010001'
WHERE version = '20260920113500';

UPDATE supabase_migrations.schema_migrations
SET version = '20261128010002' 
WHERE version = '20260920113501';
```

## ★ Default resolution
Rename files, update migration tracking via Supabase MCP SQL, run `npm run migrations:check` to confirm zero drift. Commit.
