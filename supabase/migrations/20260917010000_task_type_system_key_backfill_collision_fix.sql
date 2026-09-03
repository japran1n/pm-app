-- F006h (missions/20260903-portal, M1-scrutiny-2.md BX-1 — deploy
-- blocker): corrective, forward-only fix for 20260915020000's collision
-- bug.
--
-- Decision: a NEW migration, not an edit of 20260915020000. That file has
-- already run against the live database this mission targets — recorded
-- in supabase_migrations.schema_migrations, per scripts/apply-migration.mjs's
-- own version-ledger check — and it happened not to trip the bug there
-- only because this database doesn't hold the colliding shape. Editing an
-- already-applied file in place would not re-run it on any environment
-- where it is already recorded (this one), so a defect that already
-- shipped there would carry forward unfixed; the only environments an
-- in-place edit protects are ones that have NOT yet applied
-- 20260915020000, and even then only if their migration runner reads the
-- file fresh rather than trusting a lockfile of hashes. A new,
-- self-contained migration protects every environment uniformly — one
-- that already ran the buggy file (this one, and any other already at
-- head) gets the fix applied for the first time here; one that has not
-- yet reached 20260915020000 hits the SAME bug there first (unchanged,
-- since editing history is not being done) and then this file repairs
-- whatever the buggy statement left behind. That second case is provably
-- fine here because 20260915020000's UPDATE, even on failure, changes
-- nothing (Postgres runs the whole file as a single statement via
-- scripts/apply-migration.mjs, and a 23505 aborts the implicit
-- transaction) — so a fresh database that hits the error there is left
-- with system_key exactly where 20260912010000 left it, which is exactly
-- the starting state this file's own guard is written for. Per this
-- mission's own FU-15 recommendation (M1-scrutiny-2.md): "Add a new
-- migration (do not edit 20260915020000; it may already be recorded as
-- applied on some instances)".
--
-- Two corrections over 20260915020000's candidate selection:
--
--   1. The missing guard: a workspace that already holds a
--      `system_key = 'page'` row is excluded from the candidate set
--      entirely (`not exists`), rather than only de-duplicating AMONG
--      candidates the way `distinct on (workspace_id)` did. Every
--      workspace created since 20260912010000 is seeded with exactly
--      such a row (`create_workspace_with_owner`), so an untagged
--      "Pages"/"Sida"/"Stranica" row that coexists with it — legal,
--      since `task_types_workspace_id_name_idx` is on (workspace_id,
--      name), not on any pattern — no longer collides with
--      `task_types_workspace_id_system_key_idx` on write. Those rows are
--      left untagged; the write path 20260912010000/20260915020000
--      already added to lib/actions/task-types.ts lets a team admin tag
--      the right one by hand, which is the correct outcome when a
--      workspace has two candidate names and the migration cannot know
--      which one the team actually uses as their page type.
--   2. A deterministic tiebreak: `, id` appended to the `distinct on`
--      `order by`, so two same-ranked candidate names in one workspace
--      (e.g. "Page" and "Page " — btrim makes both rank 0) pick the same
--      row on every run instead of a plan-order-dependent one.
--
-- Idempotent by construction: re-running this file is a no-op the second
-- time, because every row it would have tagged already has
-- `system_key = 'page'`, and the `not exists` guard then excludes its own
-- workspace from the candidate set. This also makes it safe to apply
-- after 20260915020000 succeeded (a workspace with no colliding
-- second row): the `not exists` guard only ever excludes workspaces that
-- already have a *tagged* row, which is precisely the state 20260915020000
-- leaves behind when it worked.
with candidates as (
  select distinct on (t.workspace_id) t.id
  from task_types t
  where t.system_key is null
    and btrim(t.name) ilike any (array['page', 'pages', 'sida', 'stranica'])
    and not exists (
      select 1
      from task_types t2
      where t2.workspace_id = t.workspace_id
        and t2.system_key = 'page'
    )
  order by
    t.workspace_id,
    case
      when btrim(t.name) ilike 'page' then 0
      when btrim(t.name) ilike 'pages' then 1
      when btrim(t.name) ilike 'sida' then 2
      when btrim(t.name) ilike 'stranica' then 3
      else 4
    end,
    t.id
)
update task_types
set system_key = 'page'
where id in (select id from candidates);
