# Handoff: F004 — Extract ProjectCard + avatar limit prop

## Status
COMPLETE

## Assertions covered
PL-007: PASS — card shows "5 open tasks" (unit); integration project-list.test.ts is baseline-failing (no network)
PL-026: PASS — UserAvatarGroup `limit` prop (alias of max), default stays 3
PL-028: PASS — link, star, actions menu, progressbar preserved

## Files changed
components/projects/project-card.tsx
components/user-avatar-group.tsx
app/(workspace)/w/[workspaceSlug]/projects/page.tsx
tests/unit/project-card-f004.test.tsx

## Commands run
`npx vitest run tests/unit/project-card-f004.test.tsx tests/unit/user-avatar` (0)
`npx tsc --noEmit` filtered to touched files (clean)

## Decisions made
- Card JSX moved verbatim; progress math moved into ProjectCard.
- UserAvatarGroup already had `max`; added `limit` taking precedence.

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions
None.

## Notes for the next worker
teamPreviewByProject is still computed and unused in page.tsx (void); a later feature renders it via UserAvatarGroup limit={4}.
