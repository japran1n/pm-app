-- F181: task_templates table + RLS (AS-328, AS-329)
--
-- Storage-only half of "save a task as a reusable template" (the actual
-- save action is F182, not built yet; this migration just proves a
-- template row can be inserted with a valid payload and is correctly
-- workspace-scoped/guest-excluded via RLS).
--
-- ---------------------------------------------------------------------
-- Design decision (per this feature's explicit "decide here, not later"
-- instruction, since F184 depends on it): single `task_templates` table
-- with a `kind` discriminator ('task' | 'project'), NOT two separate
-- tables (`task_templates` + `project_templates`).
--
-- Reasoning (recorded here and in the handoff's Decisions Made, per the
-- clarified spec's "simpler option, no new dependency, no second source
-- of truth" default):
--   - Both kinds share every column this table needs: id, workspace_id,
--     name, payload (jsonb — shape differs by kind but both are opaque
--     JSON blobs to the DB), created_by, created_at.
--   - Both kinds share the exact same RLS shape: workspace-scoped,
--     non-guest SELECT, creator-or-admin/owner INSERT/UPDATE/DELETE. Two
--     tables would mean two copies of every policy (four policies each,
--     eight total) that must be kept in lockstep forever — a textbook
--     "second source of truth" the clarified spec's ambiguity-resolution
--     rule says to avoid.
--   - A `kind` discriminator lets F184 (project-level templates, holding
--     a project's columns + an ordered task list) add its own payload
--     shape and a scoped index/query (`where kind = 'project'`) without
--     any migration to a new table, and without this feature's RLS ever
--     needing to be touched again.
--   - The only real argument for two tables (fully independent schemas
--     per kind) doesn't apply here because `payload` is jsonb for both —
--     there's no case where one kind needs a relational column the other
--     can't simply omit inside its own JSON.
--
-- `kind` is included NOW (default 'task', CHECK constrained to the two
-- values already known) so F184 does not need a follow-up ALTER TABLE —
-- consistent with the "additive, never destructive" migration-safety
-- convention, applied here as "add the column the mission already knows
-- it needs, once, rather than twice."
-- ---------------------------------------------------------------------

create table public.task_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null default 'task' check (kind in ('task', 'project')),
  name text not null check (char_length(btrim(name)) > 0),
  payload jsonb not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.task_templates is
  'Reusable templates a workspace member can save and re-apply. kind=''task'' payload mirrors lib/recurrence/clone-fields.ts''s cloneTaskFields shape (title, description, description_json, priority, checklistItems, estimate_minutes, tags) restricted to the same field allow-list F180''s duplicate-task uses, so a template can never carry comments or attachments (F181, AS-328). kind=''project'' payload (F184) holds a project''s columns + an ordered task list; not produced by this feature.';
comment on column public.task_templates.kind is
  'Discriminator: ''task'' (this feature, F181/F182) or ''project'' (F184). Single table, not two, per this migration''s header note — shared RLS shape, shared columns, opaque jsonb payload either way.';
comment on column public.task_templates.payload is
  'Opaque jsonb; shape depends on kind. For kind=''task'': { title, description, description_json, priority, checklistItems, estimate_minutes, tags } — the same field allow-list F176''s cloneTaskFields/F180''s duplicateTask established, validated by a Zod schema at the Server Action layer (F182), not by a DB CHECK (payload shape varies too much for a useful CHECK; the DB''s job here is storage + access control, not shape validation, per this table''s two-kind design).';

-- Index every FK and every column named in this feature's main read path
-- (list templates for a workspace, optionally filtered by kind) per the
-- clarified "index every FK and every WHERE/ORDER BY column" answer.
create index task_templates_workspace_id_idx
  on public.task_templates (workspace_id);
create index task_templates_workspace_id_kind_idx
  on public.task_templates (workspace_id, kind);
create index task_templates_created_by_idx
  on public.task_templates (created_by);

alter table public.task_templates enable row level security;

-- SELECT: any active, non-guest workspace member (AS-329). Mirrors F134's
-- `wm.role <> 'guest'` guest-exclusion predicate exactly (the "shared
-- convention" the clarified spec points to) — there is no separate SQL
-- helper function for this specific predicate anywhere in the schema yet
-- (F134's own guest scoping is inlined per-policy in
-- is_project_visible_to/is_project_visible_to_row, not factored into a
-- reusable function), so this policy inlines the same
-- `wm.role <> 'guest'` condition rather than introducing a new helper
-- function for a single-clause predicate — consistent with "extend, don't
-- copy-paste a DIFFERENT predicate," while not inventing a new
-- abstraction this mission's existing code doesn't already have.
create policy task_templates_select_non_guest_members
  on public.task_templates
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = task_templates.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role <> 'guest'
    )
  );

-- INSERT: any active, non-guest member may create a template, but only as
-- themselves (created_by must be their own auth.uid()) — a guest cannot
-- create one either, since template visibility itself excludes guests and
-- a guest-authored template nobody (including the guest, on next SELECT
-- via this same policy) could ever see would be a dead write.
create policy task_templates_insert_own_non_guest
  on public.task_templates
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = task_templates.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role <> 'guest'
    )
  );

-- UPDATE/DELETE: restricted to the creator OR a workspace admin/owner, per
-- this feature's Draft scope. Mirrors the shape of every other
-- creator-or-admin policy in this schema (e.g. workspace_logos_objects_*
-- for admin-only writes, extended here with the creator branch this
-- feature's spec explicitly adds).
create policy task_templates_update_owner_or_admin
  on public.task_templates
  for update
  to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = task_templates.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    )
  )
  with check (
    created_by = auth.uid()
    or exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = task_templates.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    )
  );

create policy task_templates_delete_owner_or_admin
  on public.task_templates
  for delete
  to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = task_templates.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    )
  );

grant select, insert, update, delete on public.task_templates to authenticated;
