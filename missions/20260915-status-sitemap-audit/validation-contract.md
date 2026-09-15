# Validation contract — 20260915-status-sitemap-audit

Source: two read-only audit passes requested by the product owner ("statuses
out of sync across the app, bulk status update looks unfinished, client
portal Site map should be as powerful as the workspace Architecture board").
Full audit findings are in `audit-status.md` and `audit-sitemap.md` in this
directory.

## Status surfaces (F1)

- AS-1: Bulk-update-status offers every real status configured on the
  selected tasks' own project(s) (via `project_statuses` /
  `getProjectColumns`), scoped per-project when a selection spans multiple
  projects — never the legacy hardcoded todo/in_progress/in_review/done set.
- AS-2: Before writing a bulk status change, the target status name is
  verified to exist in that task's own project's `project_statuses`; a bulk
  update never leaves a task with `status_id = null` due to an unmatched
  name (mirrors `moveTaskStatus`'s existence check).
- AS-3: Bulk-moving a recurring task into a done-category status generates
  its next occurrence, the same as the single-task path.
- AS-4: The Task Detail Sheet's status picker offers the real per-project
  statuses (via `getProjectColumns`/`statusOptions`), not the hardcoded
  legacy 4-value `STATUS_LABELS` map.
- AS-5: Existing behavior is preserved — permission checks, per-task
  activity-log entries, watcher notifications, and portal revalidation on
  bulk status change all still function after the change.

## Portal Site map parity (F2)

- AS-6: `getArchitectureBoardForClient`'s components query is scoped to
  components referenced by at least one *returned* (client-visible,
  non-deleted) section — not every component in the project — before any
  client-facing UI is allowed to render component names/counts.
- AS-7: The portal Site map offers a read-only nested/tree (or canvas) view
  of client-visible pages reflecting the real page hierarchy, in addition to
  the existing flat column list.
- AS-8: The portal Site map applies the same CMS/component-linked visual
  color coding on section cards as the workspace board.
- AS-9: The portal Site map includes a read-only Components panel listing
  shared components (scoped per AS-6) with instance counts among
  client-visible sections.
- AS-10: Hovering one instance of a shared component in the portal Site map
  highlights every other instance of that component currently visible,
  mirroring the workspace board's hover-linking.
- AS-11: `resolveClientBucket` (components/portal/status-label.ts) stays
  byte-identical to main. This assertion is immutable.
- AS-12: `tsc`, lint, unit tests, and `next build` all pass after F1 and F2
  land.

This contract only covers F1/F2 (code fixes). The database cleanup/reseed
requested in the same conversation is a data operation carried out directly
by the orchestrator via Supabase MCP, not a worker feature, and is tracked
in `state.md` instead.
