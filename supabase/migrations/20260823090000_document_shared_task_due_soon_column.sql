-- F307 (AS-391 follow-up, FU-10 from M15 scrutiny): documentation-only
-- migration. No schema change.
--
-- F212's hourly sweep (public.notify_overdue_task_assignees(), see
-- 20260823050000_overdue_notification_sweep.sql) and the TypeScript-side
-- shared gating map (lib/notifications/preferences.ts's
-- IN_APP_COLUMN_BY_KIND, which as of this migration's companion code
-- change also covers the 'task_due_soon' kind) both read the SAME
-- notification_preferences.task_due_soon_in_app column to decide whether
-- an assignee should be notified when their task becomes overdue. A
-- literal single shared code path isn't realistic across the SQL/pg_cron
-- vs. Server Action/TypeScript boundary (the sweep has no TS runtime to
-- call into), so the two call sites are intentionally kept as two
-- implementations reading one column name -- not two independently
-- -diverging rules. This comment update makes that relationship
-- discoverable directly on the column itself, not only in migration
-- prose scattered across two files.
comment on column public.notification_preferences.task_due_soon_in_app is
  'F211/F212/F307: gates whether a user receives an in-app task_due_soon notification. Read directly by F212''s SQL sweep (notify_overdue_task_assignees(), 20260823050000_overdue_notification_sweep.sql) AND by the TypeScript-side lib/notifications/preferences.ts IN_APP_COLUMN_BY_KIND map -- both intentionally read this exact column name as their single shared source of truth; there is no single shared code implementation across the SQL/pg_cron and Server Action boundary, only a shared column name.';
