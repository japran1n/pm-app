# F106: list view status priority colors

**Milestone:** M7 — Dashboard (follow-up, also benefits M6's list view)
**Estimated worker time:** 20 minutes
**Depends on:** F073, F078
**Parent:** F073

## Assertion IDs covered
- AS-135

## Draft scope
- scrutiny-validator (M7-scrutiny.md, Finding 2) found lib/task-colors.ts (F073) is correctly used by dashboard charts, board columns, and TaskCard badges, but the List view components (task-list-table.tsx, list-status-select.tsx — F053/F057) that F078 reuses verbatim inside the dashboard render status/priority with NO color at all (plain gray shadcn badges/select) — so the same dashboard page shows a colored "Urgent" bar chart next to an uncolored "Urgent" badge in its own table below it.
- Fix: apply lib/task-colors.ts's mapping to the status Badge and priority Badge/Select in task-list-table.tsx and list-status-select.tsx. This fixes the inconsistency in BOTH F053's project list view and F078's dashboard table (same components, reused).
- Add a test: list-table row status/priority badges use the same color value as lib/task-colors.ts's mapping for a given status/priority.

## Files (approximate)
components/task/task-list-table.tsx or equivalent, components/task/list-status-select.tsx, lib/task-colors.ts, tests

## Notes for clarification
Source: M7-scrutiny.md, Finding 2. Severity: major (visible, cross-page inconsistency; also retroactively affects M6's AS-135... — AS-135 itself is scoped to M7's dashboard per the contract, but the underlying components are shared with M6).
