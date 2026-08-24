-- F223 (AS-412): the dashboard's status chart still grouped by raw
-- `tasks.status` text and rendered it through a fixed four-value
-- STATUS_LABELS/STATUS_COLORS map (lib/queries/dashboard.ts,
-- components/dashboard/status-pie-chart.tsx) — a project whose columns
-- have been renamed/added-to (F219/F221) never showed up correctly: its
-- real column name/colour were ignored in favour of the closest of the
-- four fixed buckets (or dropped entirely if the raw status text didn't
-- match any of them). 20260824060000_status_category_semantics.sql
-- explicitly called this out as still-TODO ("get_status_counts ...
-- byte-for-byte identical ... AS-412 is F223/out of this feature's
-- scope").
--
-- AUTONOMOUS_DECISION (F223 clarification's open question — "group by
-- category or by column name"): groups by column NAME. Rationale: the
-- assertion text is "the dashboard status chart reflects custom columns"
-- (plural, per-column), not "reflects the three category buckets" — a
-- category-only chart would collapse e.g. two differently-named
-- "in_progress"-category columns into one indistinguishable slice, which
-- loses exactly the information AS-412 is checking for. Grouping by name
-- is also the simpler option (matches the existing `group by status`
-- shape, adds no second source of truth) — two PROJECTS whose columns
-- happen to share a name (e.g. both call a column "Blocked") are summed
-- into one chart slice, which is the coherent workspace-wide reading:
-- the chart is answering "how many tasks are in a column named X",
-- across every project in the workspace, the same way the pre-existing
-- chart answered "how many tasks have status X" across every project.
-- Colour/category for that slice come from one arbitrarily-but-
-- deterministically chosen contributing project_statuses row (lowest
-- `id`, via `array_agg(... order by ps.id)`) when two projects' same-
-- named columns disagree on colour — documented, not hidden, since the
-- alternative (picking a colour per (project, name) pair) would turn one
-- workspace-wide chart into unreadable N-times-as-many slices.
--
-- `status_id is null` legacy rows (pre-F218 data that predates the
-- backfill, if any survive) fall back to the raw `t.status` text as the
-- group's name, `null` colour/category — same "no worse than before"
-- posture as `is_done_status`'s own status_id-null fallback
-- (20260824060000).
--
-- Return shape changes (status text -> name/color/category text), so a
-- plain `create or replace` is rejected by Postgres (see
-- https://www.postgresql.org/docs/current/sql-createfunction.html —
-- OUT parameter types must match to use CREATE OR REPLACE); drop first.
drop function if exists get_status_counts(uuid);

create function get_status_counts(p_workspace_id uuid)
returns table (name text, color text, category text, count bigint)
language sql
stable
security invoker
as $$
  select
    coalesce(ps.name, t.status) as name,
    (array_agg(ps.color order by ps.id))[1] as color,
    (array_agg(ps.category::text order by ps.id))[1] as category,
    count(*)::bigint as count
  from active_project_tasks t
  left join project_statuses ps on ps.id = t.status_id
  where t.project_workspace_id = p_workspace_id
  group by coalesce(ps.name, t.status);
$$;

revoke all on function get_status_counts(uuid) from public;
grant execute on function get_status_counts(uuid) to authenticated, anon;
