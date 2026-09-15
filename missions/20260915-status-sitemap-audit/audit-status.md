# Audit — task status inconsistency (read-only, 2026-09-15)

## Executive summary

Task status used to be a fixed 4-value enum (`todo` / `in_progress` /
`in_review` / `done`). A schema migration (F218–F223) turned it into a
**per-project, fully-custom set of statuses** (`project_statuses` table:
name/color/category/display_group/position, CRUD'd per project). A later
redesign (`20261125010000_status_set_v2.sql`) replaced the default 4 with an
**11-status set** ("Backlog, To Do, Blocked, Canceled, In Design, In Dev, QA
by Dev, QA by Design, Awaiting Client, Approved, Completed") and migrated
every existing project's data onto it — the literal strings
`"todo"/"in_progress"/"in_review"/"done"` no longer exist in
`project_statuses` for any migrated project.

Two UI surfaces + one validation schema were never updated and still
hard-code the old 4-value set. Bulk update is the worst-affected: no
existence check, can silently orphan `status_id`.

## A. Canonical status definition(s) + source

No single canonical enum anymore — three/four layers, which now disagree:

1. **Real canonical source — `project_statuses` table** (per-project,
   dynamic). Schema: `supabase/migrations/20260824010000_project_statuses.sql`
   (category CHECK in not_started/in_progress/done). `display_group` added by
   `20261125010000_status_set_v2.sql` (CHECK not_started/active/done/closed).
   `client_bucket`/`client_description` added by
   `20260911010000_status_client_bucket.sql`. Default seed (11-status set)
   written by `seed_default_project_statuses()` in
   `20261125010000_status_set_v2.sql`. Read path: `lib/queries/statuses.ts`
   `getProjectColumns()`. `tasks.status` (text) is a denormalized mirror of
   the row's `name`, kept in sync by trigger
   `sync_task_status_and_status_id`. `tasks.status_id` is the real FK. The
   old DB-level `tasks_status_check` CHECK (fixed 4 values) was **dropped**
   in `20260824020000_project_statuses_management.sql:37` — the database no
   longer restricts status to 4 values at all.
2. **Legacy TS literal union** — `TaskCardTask["status"]`,
   `components/task/task-card.tsx:72`:
   `status: "todo" | "in_progress" | "in_review" | "done"`. Predates
   per-project columns, routinely falsified (real values are strings like
   `"In Design"`); call sites cast through it with
   `as TaskCardTask["status"]` just to satisfy the type checker.
3. **Legacy label/color maps** — `lib/task-colors.ts:48-71`
   `STATUS_COLORS`/`STATUS_LABELS`, only 4 keys. Fine as a fallback
   (`components/board/board-column.tsx:193`, `statusLabelFor()` at
   `lib/task-colors.ts:76-78`), broken when used as the *only* source (see
   B).
4. **Display metadata layer** — `lib/board/status-icons.ts`
   (`STATUS_ICON_BY_NAME`, `STATUS_GROUP_LABELS/ORDER`, `resolveStatusGroup`)
   — icons/section grouping for the current 11-status set, layered on top of
   #1.

## B. UI surfaces — statuses offered → gaps

| Surface | File | Statuses offered | Gap |
|---|---|---|---|
| Board (drag & drop) | `components/board/board.tsx`, `board-column.tsx` | Real per-project via `getProjectColumns()` | None. |
| List view inline status cell | `components/task/list-status-select.tsx:94-300` | Real per-project `statusOptions` prop, wired in `app/(workspace)/.../list/page.tsx`; falls back to `DEFAULT_STATUS_OPTIONS` (the *current* 11-status set) only with no options passed | None — maintained correctly. |
| My Tasks status cell | `components/task/my-task-status-cell.tsx` + `my-tasks/page.tsx:138-155` | Real per-project options, batched per distinct `project_id` | None. |
| Calendar status filter | `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx:111-150` | Real `getProjectColumns`-derived options | None. |
| **Task Detail Sheet** | `components/task/task-detail-fields.tsx:87-92, 913-930` | **Local hardcoded** `STATUS_LABELS = {todo,in_progress,in_review,done}` | **Stale.** No `statusOptions`/`getProjectColumns` prop anywhere in the file. Submitting via `moveTaskStatus` (`lib/actions/tasks/ordering.ts` ~137-142) is rejected server-side ("That column no longer exists...") unless the project happens to still have a literal `todo`/etc. column. Most user-visible instance of the bug. |
| Bulk-update-status toolbar | `components/task/bulk-status-action.tsx:38-43` | Hardcoded `STATUS_OPTIONS` = same old 4, from `lib/task-colors.ts` | See section C — worst-affected surface. |
| List/Filters dropdown | `components/task/list-filters.tsx:56-61` | `DEFAULT_STATUS_OPTIONS` = old 4, used only as fallback for callers without a single project's columns (documented, deliberate, lower severity) | Only hit by cross-project views like `dashboard-task-table.tsx`. |
| Board column admin ("Board columns" settings) | `components/project/status-manager.tsx` | Full CRUD over real `project_statuses` via `lib/actions/statuses.ts` | Richest surface — the baseline others should match. |
| Portal (client) view | `components/portal/status-pill.tsx`, `lib/portal/status-bucket.ts` | Read-only `resolveClientBucket()` output, not a picker | N/A, not a picker. |

## C. Bulk-update-status — detailed gap analysis

Files: `components/task/bulk-status-action.tsx`,
`components/task/bulk-action-bar.tsx` (shell), `lib/actions/tasks/bulk.ts`
(`bulkUpdateTasks`), `lib/validation/tasks.ts:501-522`
(`bulkUpdateTasksSchema`). Rendered from
`components/task/task-list-table.tsx:957-967`.

Current UI (`bulk-status-action.tsx:38-43`):
```ts
const STATUS_OPTIONS: { value: TaskCardTask["status"]; label: string }[] = [
  { value: "todo", label: STATUS_LABELS.todo },
  { value: "in_progress", label: STATUS_LABELS.in_progress },
  { value: "in_review", label: STATUS_LABELS.in_review },
  { value: "done", label: STATUS_LABELS.done },
];
```
No `statusOptions` prop exists on `BulkStatusAction` at all (unlike
`ListStatusSelect`/`MyTaskStatusCell`).

Server-side schema (`lib/validation/tasks.ts:509-511`):
```ts
// Matches `tasks_status_check` — same fixed 4-value set as moveTaskStatusSchema.
status: z.enum(["todo", "in_progress", "in_review", "done"]),
```
Comment is wrong on both counts: `tasks_status_check` was dropped, and
`moveTaskStatusSchema` (`lib/validation/tasks.ts:388-395`) does NOT restrict
to 4 values — it accepts any non-empty string ≤100 chars, exactly to admit
custom/renamed columns.

Concrete gaps vs. the real per-task path (`moveTaskStatus`,
`lib/actions/tasks/ordering.ts:69-284`):

1. **No real status list.** 10 of the 11 real default statuses (and any
   further custom ones) are unreachable from bulk.
2. **No cross-project scoping.** `TaskListTable`/`BulkStatusAction` is used
   from both single-project and multi-project views (e.g. `my-tasks`), which
   already build a per-project status-options map elsewhere
   (`statusOptionsByProject`, `my-tasks/page.tsx:138-155`). Bulk ignores
   this — one global (stale) list regardless of which project(s) are
   selected.
3. **No existence check → silent status/status_id desync.**
   `moveTaskStatus` validates the target name against that task's own
   project's `project_statuses` before writing (`ordering.ts:130-142`,
   comment: "the DB trigger... fails silently (leaves status_id null) for an
   unmatched name... this check is the real guard"). `bulkUpdateTasks`
   (`lib/actions/tasks/bulk.ts:261-269`) has no such check — writes
   `tasks.status = 'todo'` directly, the sync trigger finds no matching
   `project_statuses` row on a migrated project, sets `status_id = NULL`.
   Net effect: silently orphans the task off the board, with no error
   surfaced (toast reports success).
4. **No completion/recurrence side effect.** `moveTaskStatus` generates the
   next occurrence for a recurring task moved into a done-category status
   (`ordering.ts:220-249`, `isDoneStatus` + `generateNextOccurrence`).
   `bulkUpdateTasks` has no equivalent.
5. **Done-category confirmation guard is checking a status that won't
   resolve.** `BulkStatusAction` calls `confirmIfMovingToDone` per task
   before submitting (`bulk-status-action.tsx:70-75`) — reasonable, but
   since bulk only ever proposes the dead literal `"done"`, on a migrated
   project this won't match any real column's category.
6. **A helper already exists for this and isn't used.**
   `lib/tasks/resolve-status.ts` `resolveProjectStatusName()` lets
   legacy-default callers (`lib/tasks/create.ts`, `lib/actions/templates.ts`,
   `lib/recurrence/generate-next-occurrence.ts`) resolve a legacy name onto
   the real v2 column per project. `bulkUpdateTasks`/`bulkUpdateTasksSchema`
   don't import or use it.
7. **No regression coverage for this drift.**
   `tests/integration/bulk-update-tasks.test.ts:230,258` and
   `tests/unit/list-table-bulk-selection.test.tsx:71` still assert/fixture
   against `"todo"`/`"in_progress"`/`"active"` — never updated after
   `status_set_v2`.
8. **Cosmetic/capability parity gaps** vs `ListStatusSelect`: no grouped
   sections, no per-status icon, no ability to target a custom/renamed
   column or client-bucket-tagged status.

**What already works correctly in bulk** (don't regress): per-task
permission checks (`canEditTask`, private-project visibility), per-task
activity-log entries (`writeTaskFieldChanges`), status-changed notification
fan-out to watchers, portal revalidation gated on `client_visible`
(`revalidatePortalForBulkContexts`, `lib/actions/tasks/bulk.ts:64-76,451,645`).

## D. Other status-sync risks (context only, not necessarily in this pass's scope)

- Task Detail Sheet's local `STATUS_LABELS` even differs in capitalization
  from `lib/task-colors.ts`'s copy (`"To do"` vs `"To Do"`).
- Two independent "is this done" derivations: correct one is
  `isDoneStatus`/`isDoneCategory` (`lib/tasks/status-category.ts:27-41`,
  category-based); several older fallback paths literal-compare
  `status === "done"` (documented degraded fallback at
  `status-category.ts:14-24`).
- `display_group` vs `category` split: `Approved` and `Completed` share
  `category = 'done'` but render in different dropdown sections via
  `display_group` (`lib/board/status-icons.ts:64-88`). Code reading
  `category` alone can't distinguish them.
- `resolveClientBucket`/`ClientBucket` (`components/portal/status-label.ts`)
  is a deliberately separate, already-consolidated fourth vocabulary for the
  client-facing bucket — not currently drifting, and NOT to be touched by
  this pass (AS-11, immutable).
- `projects` has no stored `status` column; `projectHealthLabel()`
  (`components/portal/status-label.ts`) is a derived, non-persisted label —
  can't drift, but is a fifth informal "status" word worth being aware of.
