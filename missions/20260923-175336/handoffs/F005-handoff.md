# Handoff: F005 — New card layout: top zone + inner panel

## Status
COMPLETE

## Assertions covered
PL-020: PASS — top zone (bg-muted/30) + inner panel with due date, Progress; footer left for F006
PL-021: PASS — phase name, else first non-empty description line, else none
PL-022: PASS — percent mono, progressbar retained, zero tasks shows "No tasks yet" no bar
PL-027: PASS — due date and percent font-mono

## Files changed
components/projects/project-card.tsx
lib/queries/projects.ts
tests/unit/project-card-f004.test.tsx

## Commands run
`npx vitest run tests/unit/project-card-f004.test.tsx` (0)
`npx tsc --noEmit` filtered to touched files (clean)
`npx eslint` touched files (0)

## Decisions made
- Added optional targetLaunchDate to ProjectListItem and the getWorkspaceProjects select.
- Open-task and health badges kept in place below the inner panel.

## Out-of-scope work needed
Footer (avatars + time pill) is F006.

## Blockers

## Autonomous decisions
None.

## Notes for the next worker
Due date is shown as the raw ISO string (mono); F006 may format it.
