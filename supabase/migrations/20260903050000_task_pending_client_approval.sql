-- F1 (docs/client-dashboard-features-plan.md): explicit "waiting on the
-- client" flag, independent of status.
--
-- The portal's existing "waiting on you" list infers this from a regex on
-- the status name (`/review/i`), which only works if a team names their
-- status exactly "In Review" and breaks the moment they rename it or add a
-- second review-like status. This column makes the signal an explicit act
-- by the team instead of a string match, the same reasoning that motivated
-- `client_visible` in 20260902010000: sharing (and now, asking for a
-- decision) is deliberate, not inferred.
--
-- No RLS change is needed: Postgres RLS is row-level, not column-level, and
-- this column rides on the same `tasks` row already gated by
-- `client_visible` + `is_project_visible_to()` from that migration. A task
-- a client cannot see does not leak this flag either, because they cannot
-- see the row at all.

alter table tasks
  add column if not exists pending_client_approval boolean not null default false;

-- Same reasoning as the `client_visible` partial index: the portal's read
-- is "the small set of shared tasks currently awaiting a decision", and the
-- overwhelming majority of rows will always have this false.
create index if not exists tasks_project_id_pending_client_approval_idx
  on tasks (project_id)
  where pending_client_approval;
