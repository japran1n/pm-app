# Handoff: F007 — Semantic health colours + hover

## Status
COMPLETE

## Assertions covered
PL-023: PASS — constants are var(--brand/--warning/--destructive); bar/pill use text-/bg- token classes
PL-024: PASS — time pill is now Badge (pill, uppercase, 9px, 10% tint) coloured by health
PL-029: PASS — hover-lift replaced by hover:border-border-control-hover
PL-032: PASS — tokens defined at root from knobs; no per-theme hex

## Files changed
lib/projects/compute-health.ts
components/projects/project-card.tsx
tests/unit/f007-health-colours.test.tsx

## Commands run
`npx vitest run` f007, project-card-f004, compute-project-health (0)
`npx tsc --noEmit` (0)
`npx eslint` touched files (0)

## Decisions made
- Added PROJECT_HEALTH_TEXT_CLASS/BAR_CLASS literal maps (Tailwind needs static strings).
- project-health-badge.tsx still uses StatusBadge with the var() colours; unchanged.

## Out-of-scope work needed
None.

## Blockers
None.

## Autonomous decisions
None.

## Notes for the next worker
Test PL-032 is a static CSS check, not a rendered one.
