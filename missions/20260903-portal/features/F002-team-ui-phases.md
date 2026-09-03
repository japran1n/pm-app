# F002: Team UI — project phases

**Milestone:** M1
**Estimated worker time:** 2–3 h
**Depends on:** F001 (tables + `seed_default_phases`)

## Assertion IDs covered
- AS-008: Each project can hold an ordered list of phases, each with a client-facing name, description, state, and planned dates.
- AS-013: A team member can assign a task to a phase from the task detail sheet, and the assignment survives a reload.

## Scope

### 1. Settings page

`app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/phases/page.tsx`
plus `error.tsx` and `loading.tsx`, matching the sibling
`settings/columns` route exactly in structure and chrome.

Rows show: position handle, name, client description, state select,
planned start/end, client-visible switch, delete. Plus:
- "Add phase" inline.
- **"Add the standard ten phases"** — calls `seed_default_phases`;
  visible only when the project has no phases yet.
- Reordering: reuse the same interaction the columns settings page uses
  for statuses. Do not introduce a second drag library.

Add the tab to `components/project-tabs.tsx` next to the existing
settings entries.

### 2. Server actions

`lib/actions/phases.ts` — `createPhase`, `updatePhase`, `deletePhase`,
`reorderPhases`, `seedDefaultPhases`. Zod schemas in
`lib/validation/phases.ts`. Authorisation goes through the existing
`lib/actions/authz.ts` seam — do not hand-roll a role check.

Deleting a phase that has tasks must not delete the tasks: `phase_id`
is `on delete set null` (F001), so the action only needs to warn — show
how many tasks will be unassigned and require confirmation.

### 3. Phase on the task

- `components/task/task-detail-sheet.tsx`: a phase select beside the
  existing status/priority controls, following the optimistic pattern
  those controls already use.
- `components/task/new-task-dialog.tsx`: same select, defaulting to the
  project's first `active` phase, or the first phase if none is active.
- `components/task/bulk-action-bar.tsx`: "Move to phase" bulk action,
  mirroring the existing bulk status action.

## Files (approximate)

- `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/phases/{page,error,loading}.tsx`
- `components/project/phase-list.tsx` (new)
- `components/task/task-detail-sheet.tsx`, `new-task-dialog.tsx`, `bulk-action-bar.tsx`
- `components/project-tabs.tsx`
- `lib/actions/phases.ts`, `lib/validation/phases.ts`, `lib/queries/phases.ts`

## Notes

- Read `settings/columns/page.tsx` and `lib/actions/statuses.ts` first;
  this feature is deliberately the same shape one level over.
- Tokens only. No hex, no literal radius.

## Definition of done

- **Primary success test:** integration test — creating, renaming,
  reordering and deleting a phase through the server actions produces
  the expected rows; assigning a task to a phase persists.
- **Failure test:** a `viewer` and a `client` are rejected by every
  phase mutation action.
- **Manual verification:** on a scratch project, "Add the standard ten
  phases" produces the ten rows in order, and the button disappears
  afterwards.
- **Side-effect verification:** `npx tsc --noEmit` clean; existing task
  detail sheet tests still pass.
