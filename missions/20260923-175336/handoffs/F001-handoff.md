# Handoff: F001 — Baseline + phase name in health inputs

## Status
COMPLETE

## Assertions covered
PL-001: PASS — baseline recorded in run-log.md and baseline-failing-files.txt
PL-010: PASS — test_PL_010 passes; currentPhase.name added (null when no active phase)

## Files changed
lib/queries/projects.ts
lib/queries/projects-health-inputs.test.ts
missions/20260923-175336/run-log.md
missions/20260923-175336/baseline-failing-files.txt

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (1, baseline 66 errors)
`npx vitest run` (1, baseline 298 failing files, mostly integration needing env)
`npm run migrations:check` (0)
`npx vitest run lib/queries/projects-health-inputs.test.ts` (0)

## Decisions made
- Added name to currentPhase; did not touch ProjectHealthPhase (compute-health) since tsc stays clean.

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions

## Notes for the next worker
Baseline failing list is at missions/20260923-175336/baseline-failing-files.txt.
