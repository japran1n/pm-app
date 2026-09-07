-- Follow-up to F227/F228/F229 saved views: manual task membership in a
-- saved view, independent of that view's filter config. Requested
-- explicitly by the user ("da mogu rucno da ubacim taskove") as a
-- ClickUp-style "assign a task to this list" affordance that a
-- filter-only view (supabase/migrations/20260826010000_create_saved_views.sql)
-- cannot express on its own.
--
-- `view_tasks` is a pure join table: which tasks are manually pinned into
-- which saved view, in what order. It carries NO filter semantics itself
-- -- lib/views/apply-view.ts's `mergeManualTaskIds` is responsible for
-- unioning this table's task ids with whatever a view's own `config`
-- filter already matches (see that module's header comment).
--
-- RLS mirrors `saved_views`' own policy shape exactly (same visibility
-- and write-authorization floor as the view row itself): a caller may
-- read/write a `view_tasks` row only when they could read/write the
-- `saved_views` row it references, via the SAME `is_project_visible_to`/
-- `is_active_workspace_member` helpers `saved_views`' own RLS uses, plus
-- ownership for shared-view writes (matching lib/actions/views.ts's own
-- "owner OR admin-of-shared-view" application-layer rule for the write
-- actions in lib/actions/view-tasks.ts). RLS here is intentionally only
-- the "owner can always write their own view's membership" floor -- the
-- admin-of-a-shared-view exception, exactly like saved_views' own UPDATE/
-- DELETE policies, is re-checked and executed via the admin client at
-- the Server Action layer, not carved into RLS.
--
-- task_id references `public.tasks`; a task belongs to whatever project
-- the view belongs to in practice (enforced by the Server Action, not by
-- an FK -- `saved_views.project_id` is nullable for workspace-level views,
-- so there's no single-column DB constraint that could express "this
-- task's project_id must equal this view's project_id" cleanly across
-- both project- and workspace-scoped views).

create table if not exists public.view_tasks (
  id uuid primary key default gen_random_uuid(),
  view_id uuid not null references public.saved_views (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  position double precision not null default 0,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users (id) on delete set null,
  constraint view_tasks_view_task_unique unique (view_id, task_id)
);

comment on table public.view_tasks is
  'Manual (filter-independent) task membership in a saved view -- ClickUp-style "add this task to this list". Unioned with a view''s own filter results by lib/views/apply-view.ts''s mergeManualTaskIds.';

create index if not exists view_tasks_view_id_idx on public.view_tasks (view_id);
create index if not exists view_tasks_task_id_idx on public.view_tasks (task_id);

alter table public.view_tasks enable row level security;

-- SELECT: visible whenever the referenced saved_views row is visible --
-- reuses saved_views' own RLS as the source of truth via a correlated
-- subquery rather than re-deriving the visibility predicate a second time
-- (any future change to saved_views' visibility rule is inherited here
-- automatically instead of silently drifting).
drop policy if exists view_tasks_select_visible on public.view_tasks;
create policy view_tasks_select_visible
  on public.view_tasks
  for select
  to authenticated
  using (
    exists (
      select 1 from public.saved_views sv
      where sv.id = view_tasks.view_id
        and (
          sv.owner_id = auth.uid()
          or (
            sv.scope = 'shared'
            and (
              (sv.project_id is not null and public.is_project_visible_to(sv.project_id))
              or (sv.project_id is null and public.is_active_workspace_member(sv.workspace_id))
            )
          )
        )
    )
  );

-- INSERT/UPDATE/DELETE: only the view's own owner may manage membership
-- via RLS directly (same floor as saved_views' UPDATE/DELETE policies).
-- The admin-of-a-shared-view exception (AS-430's rule, mirrored for
-- membership management) is enforced at the Server Action layer via the
-- admin client, exactly like updateSavedView/deleteSavedView already do.
drop policy if exists view_tasks_insert_owner on public.view_tasks;
create policy view_tasks_insert_owner
  on public.view_tasks
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.saved_views sv
      where sv.id = view_tasks.view_id
        and sv.owner_id = auth.uid()
    )
  );

drop policy if exists view_tasks_update_owner on public.view_tasks;
create policy view_tasks_update_owner
  on public.view_tasks
  for update
  to authenticated
  using (
    exists (
      select 1 from public.saved_views sv
      where sv.id = view_tasks.view_id
        and sv.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.saved_views sv
      where sv.id = view_tasks.view_id
        and sv.owner_id = auth.uid()
    )
  );

drop policy if exists view_tasks_delete_owner on public.view_tasks;
create policy view_tasks_delete_owner
  on public.view_tasks
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.saved_views sv
      where sv.id = view_tasks.view_id
        and sv.owner_id = auth.uid()
    )
  );

-- No policy for anon: absence of a matching policy denies access by
-- default under RLS, matching this repo's established convention.
