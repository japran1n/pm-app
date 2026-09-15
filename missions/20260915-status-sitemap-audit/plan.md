# Plan — Status surface fixes + portal Site map parity

_Mission: 20260915-status-sitemap-audit. Ad-hoc audit-and-fix engagement
requested directly by the product owner (not run through the full
scope/discover/plan interrogation — the two read-only audits below already
pinned down exact files/lines, and the owner confirmed scope via quick
questions instead of the full round-1/round-2 questionnaire)._

Constraints: `resolveClientBucket` untouched. Serial workers, one commit per
feature. Full gate before done: tsc, lint, unit tests, next build.

## F1: Status surfaces (bulk update + task detail sheet)

Root cause: the app moved from a fixed 4-value task status
(`todo/in_progress/in_review/done`) to a per-project custom status set
(`project_statuses` table, currently an 11-status default). Two UI surfaces
never migrated: `components/task/bulk-status-action.tsx` and
`components/task/task-detail-fields.tsx`'s status picker, both still hardcode
the dead 4-value set. Bulk update is worse than just stale — it has no
existence check before writing, so a bulk status change can silently orphan
`tasks.status_id` (leaves the task off the board).

Fix (see `audit-status.md` for full detail and exact file:line refs):
- `bulk-status-action.tsx`: take a `statusOptions` prop sourced from
  `getProjectColumns` per project in the selection (same pattern
  `ListStatusSelect`/`MyTaskStatusCell` already use), instead of the
  hardcoded `STATUS_OPTIONS` from `lib/task-colors.ts`.
- `lib/validation/tasks.ts` `bulkUpdateTasksSchema`: relax `status` from
  `z.enum([...4 values])` to a free-form non-empty string (mirror
  `moveTaskStatusSchema`), re-verified server-side.
- `lib/actions/tasks/bulk.ts` `bulkUpdateTasks`: before writing, verify the
  target status name exists in each affected task's own project's
  `project_statuses` (batch this per distinct `(project_id, name)` pair —
  don't do one query per task). Skip/report tasks whose project has no
  matching status instead of silently orphaning `status_id`.
- Add the same done-category recurrence side effect `moveTaskStatus` has
  (`generateNextOccurrence` on a recurring task moving into a done-category
  status) — AS-3.
- `task-detail-fields.tsx`: replace the local hardcoded `STATUS_LABELS`
  status picker with the real per-project `statusOptions`
  (`getProjectColumns`), matching how the picker already works elsewhere.
- Update the stale tests that hardcode the old 4 values
  (`tests/integration/bulk-update-tasks.test.ts`,
  `tests/unit/list-table-bulk-selection.test.tsx`, and any task-detail-sheet
  status tests) to assert against real project statuses instead.

Assertions: AS-1 through AS-5.

## F2: Portal Site map parity

Root cause: the client-facing "Site map" (renamed from "Architecture" by
mission `20260910-... /20260914-portal-simplify`) only ever got a flat,
non-nested column list (`components/architecture/client-board.tsx`,
`client-page-column.tsx`). The workspace board has a richer canvas/tree view,
a Components panel with instance counts and "appears on" navigation, CSS
hover-linking of shared components, and CMS/component-linked color coding —
none of which made it to the portal, even though the underlying
`getArchitectureBoardForClient` query already fetches (and discards) the
components list.

Fix (see `audit-sitemap.md` for full capability inventory and file:line
refs):
- First, close the latent leak noted in the audit: scope
  `getArchitectureBoardForClient`'s components query
  (`lib/queries/architecture.ts` ~249-252) to components referenced by at
  least one *returned* (client-visible, non-deleted) section — do this
  before wiring the data into any new client-facing UI. AS-6.
- Add a read-only nested/tree (or canvas) view of the page hierarchy to the
  portal Site map, reusing `lib/architecture/page-tree.ts`'s `buildPageTree`
  and drawing from `canvas-board.tsx`'s approach minus every editing
  affordance (no drag, no create/rename/delete). AS-7.
- Apply the same CMS/component-linked color coding to portal section cards
  that `section-card.tsx` uses on the workspace side. AS-8.
- Add a read-only Components panel to the portal Site map (list of shared
  components + instance counts among client-visible sections, scoped per
  AS-6) — a trimmed version of `component-panel.tsx` with the
  editing/rename/delete controls removed. AS-9.
- Wire up the existing CSS-only hover-linking mechanism
  (`lib/architecture/use-component-hover.ts`) on the portal board the same
  way the workspace board and canvas already use it. AS-10.
- Do NOT touch `resolveClientBucket` (AS-11 is immutable). Do NOT add
  editing affordances (create/rename/delete/reorder/drag) to any portal
  surface — the portal stays read-only.
- Out of scope for this pass (noted by the audit as lower priority /
  separate concerns, do not attempt): Sitemap import/export for clients,
  merging the separate portal "Pages" table (status/progress) with Site map,
  page/section-level status indicators (doesn't exist on the workspace board
  either — would be new scope, not parity restoration), comments on
  pages/sections (doesn't exist anywhere in the app).

Assertions: AS-6 through AS-11.

## Milestones

- F1 and F2 run as two parallel workers (touch disjoint files, low collision
  risk). Each worker verifies with its own automated tests
  (vitest/playwright) rather than manually browsing the live "Goodguys Demo"
  workspace project — the orchestrator is concurrently wiping/reseeding that
  project's data as a separate, unrelated data-layer task.
- After both land: orchestrator runs the full gate (tsc, lint, unit tests,
  next build) per AS-12, then updates `state.md`.
