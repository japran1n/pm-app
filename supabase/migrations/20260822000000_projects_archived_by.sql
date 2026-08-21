-- F142: project archive view (AS-250, AS-251, AS-256).
--
-- AS-251 requires the archive view to show, per project, "when it was
-- archived and by whom". "When" already exists: `archiveProject`
-- (lib/actions/projects.ts, F029) sets `projects.deleted_at = now()` when
-- a project is archived, and `deleted_at IS NULL` is this codebase's one
-- established soft-delete/archive convention (tech-decisions.md) — adding
-- a second, parallel `archived_at` timestamp column would create a second
-- source of truth for "is this archived and when", which the clarified
-- spec's ambiguity-resolution default explicitly rules out ("the simpler
-- option that adds no new dependency and no second source of truth").
-- `deleted_at` IS the archive timestamp for a project; this view reads it
-- as such.
--
-- "By whom" has no existing column anywhere on `projects` — confirmed via
-- `lib/supabase/database.types.ts`'s `projects` Row type (only
-- created_by, no archived_by/actor tracking) and by reading
-- `archiveProject` itself, which never records the acting user's id on
-- the row. The `audit_log` table (F139) does record the acting user for
-- the `project.archived` action, but `writeAudit()`'s own header comment
-- states writes are best-effort and non-fatal ("a failed audit write is
-- logged via console.error and otherwise swallowed... not a precondition
-- for it") — relying on audit_log as the sole source for AS-251 would
-- make "by whom" silently absent whenever that RPC call fails, which is
-- not an acceptable data source for an assertion the archive view must
-- satisfy reliably. So `archived_by` is added directly to `projects`,
-- populated atomically in the same update statement that sets
-- `deleted_at`, guaranteeing it's never missing for a project archived
-- through the one Server Action that can archive one.
--
-- Additive only, per this feature's inherited "additive first" migration
-- convention (F142 clarification, Round B Q4): a new nullable column,
-- nothing dropped, nothing backfilled with a guess for already-archived
-- rows (there is no way to know who archived a pre-existing archived
-- project, so it stays NULL and the UI must handle that explicitly).
alter table projects
  add column if not exists archived_by uuid references auth.users (id);

comment on column projects.archived_by is
  'F142/AS-251: the user who archived this project, set by archiveProject() in the same update that sets deleted_at. NULL for projects archived before this column existed, or for projects that are not archived.';
