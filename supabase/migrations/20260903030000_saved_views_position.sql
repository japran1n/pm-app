-- F401 (docs/plan-daily-work-followups.md, M1 "views as tabs"): adds the
-- one column the existing saved-views system (F227-F229) was missing to
-- render as an ordered tab row instead of only a dropdown — `position`.
--
-- Everything else "views as tabs" needs already exists and is already
-- tested: creating a view (createSavedView), applying one via `?viewId=`
-- (the List page's own query-param resolution), the visibility RLS
-- (shared views visible to the project, personal views owner-only). This
-- migration and the UI built on top of it are additive on top of that —
-- no new filter-application logic, no new RLS shape, because none is
-- needed.
--
-- Nullable-with-default, per this project's expand-before-contract
-- convention: existing rows backfill in `created_at` order (their current
-- de facto order everywhere they're read today), so no existing saved
-- view's apparent order changes the moment this migration runs.

alter table saved_views add column if not exists position double precision not null default 0;

with ordered as (
  select id, row_number() over (
    partition by project_id, view_type
    order by created_at
  ) as rn
  from saved_views
)
update saved_views sv
set position = ordered.rn * 1000
from ordered
where ordered.id = sv.id
  and sv.position = 0;

create index if not exists saved_views_project_id_view_type_position_idx
  on saved_views (project_id, view_type, position);
