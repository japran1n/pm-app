# Handoff: F006 — Card footer: avatars + time pill + tooltip

## Status
COMPLETE

## Assertions covered
PL-024: PASS — pill shows computeTimeLeft, else health label
PL-025: PASS — title carries health label + reason
PL-026: PASS — footer UserAvatarGroup limit=4, +N

## Files changed
components/projects/project-card.tsx
app/(workspace)/w/[workspaceSlug]/projects/page.tsx
tests/unit/project-card-f004.test.tsx

## Commands run
`npx vitest run tests/unit/project-card-f004.test.tsx` (0)
`npx tsc --noEmit` (no errors in touched files)
`npx eslint` touched files (0)

## Decisions made
- Reused StatusBadge for pill (health colour source; F007 recolours); title wrapper span since StatusBadge has no title prop.
- Reason built from overdue task count + current phase; fallback text when none.
- Due date formatted en-US medium UTC; updated F005 test expectation accordingly.

## Out-of-scope work needed
F007: semantic colours (PROJECT_HEALTH_COLORS hex fallbacks).

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: tooltip is native title attribute.

## Notes for the next worker
Pill uses StatusBadge rounded-md; pill-shape/Badge-rules polish may belong to F007.
