-- Consolidation follow-up to 20261116010000: quick_notes duplicated
-- personal_todos (see that migration's comment and
-- 20261116010000_personal_todos_task_project_links.sql). Its only extra
-- capability (optional task_id/project_id) has been folded into
-- personal_todos, so this table is no longer needed.

drop table if exists quick_notes;
