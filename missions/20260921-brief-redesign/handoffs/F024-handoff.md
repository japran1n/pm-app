# Handoff: F024 — Minors: page + queries

## Status
COMPLETE

## Assertions covered
BR-022: PASS — latest answered row helper unit-tested (blank newer rows ignored)
BR-023: PASS — Date comparison unit-tested (mixed ISO offsets)
BR-026: PASS — docs-lookup notice now text-warning, role=alert, names unavailable actions (structural, server component)
BR-017: PASS — profile lookup error is logged via logger.error AND names degrade to null; test asserts both

## Files changed
lib/queries/brief.ts
lib/brief/latest-answer.ts
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/brief/page.tsx
tests/unit/brief-profile-lookup-nonfatal.test.ts
tests/unit/brief-latest-answer.test.ts

## Commands run
`npx tsc --noEmit` (only baseline LayoutProps error)
`npx eslint <touched paths>` (0)
`npx vitest run tests/unit/brief- f048 f066 f067 f070 lib/brief` (1: 4 failures all in f048-component-panel-dnd, unrelated ArchitectureActionsProvider baseline; all brief tests pass)

## Decisions made
- loadProfileNames already logged at error level; added context (id count) and message, kept degrade behaviour.
- Extracted pickLatestAnsweredRow to lib/brief/latest-answer.ts; rows with unparseable timestamps or unknown questions are skipped.
- Approval buttons: when docs lookup fails, the single warning alert explains Generate/Request Approval/Approve are unavailable until reload.

## Out-of-scope work needed
f048-component-panel-dnd.test.tsx fails on the baseline (missing ArchitectureActionsProvider in test render); separate fix.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Used text-warning + role="alert" (existing token) for the notice.

## Notes for the next worker
None.
