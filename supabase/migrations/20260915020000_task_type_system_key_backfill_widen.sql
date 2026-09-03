-- F006c (missions/20260903-portal, AS-014): widen
-- 20260912010000_task_type_system_key.sql's backfill. That migration's
-- `where system_key is null and name ilike 'page'` is an exact
-- case-insensitive match with no wildcard — M1-scrutiny.md's B5 verified
-- that types named "Pages" (plural), "Page " (trailing space — the
-- non-blank check on `name` still passes a trailing-space value), the
-- Swedish "Sida" and the Croatian/Serbian/Bosnian "Stranica" all get
-- nothing, leaving a workspace already using one of those names with a
-- permanently empty Pages view and no in-app way to fix it (the write
-- path this same migration's sibling change in lib/actions/task-types.ts
-- adds is the actual, ongoing fix; this backfill only catches names that
-- already exist in the data today).
--
-- Matched here (case-insensitive, surrounding whitespace trimmed):
--   'page'      — already covered by 20260912010000, re-stated so this
--                 backfill is a complete, idempotent superset on its own
--   'pages'     — the plural F006c's own spec text uses as an example
--   'sida'      — Swedish for "page", the exact case M1-scrutiny.md's
--                 B4 trigger and this feature's spec both name
--   'stranica'  — Croatian/Serbian/Bosnian for "page", named in
--                 M1-scrutiny.md's B5
-- `btrim(name)` (not bare `name`) is compared so a trailing-space
-- "Page " row (M1-scrutiny.md's second example) matches too — `ilike`
-- alone does not trim whitespace.
--
-- 20260912010000's own backfill comment reasoned that its single exact
-- pattern could match at most one row per workspace, because
-- `task_types_workspace_id_name_idx` (20260903040000) already forbids
-- two rows sharing a name. That reasoning does NOT extend to four
-- patterns at once: a workspace could have both a "Page" row and a
-- separate "Pages" row (different names, both legal), and setting
-- `system_key = 'page'` on both in the same statement would violate
-- `task_types_workspace_id_system_key_idx`. `distinct on (workspace_id)`
-- picks exactly one candidate per workspace — the ordering below prefers
-- the exact "page" match first, then the plural, then the two
-- translations — so this backfill can never itself trip the partial
-- unique index it's writing into.
with candidates as (
  select distinct on (workspace_id) id
  from task_types
  where system_key is null
    and btrim(name) ilike any (array['page', 'pages', 'sida', 'stranica'])
  order by
    workspace_id,
    case
      when btrim(name) ilike 'page' then 0
      when btrim(name) ilike 'pages' then 1
      when btrim(name) ilike 'sida' then 2
      when btrim(name) ilike 'stranica' then 3
      else 4
    end
)
update task_types
set system_key = 'page'
where id in (select id from candidates);
