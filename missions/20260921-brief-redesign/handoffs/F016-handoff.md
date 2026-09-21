# Handoff: F016 — remove N+1 profile lookup

## Status
COMPLETE

## Assertions covered
BR-017: PASS — getBriefWithRevisions issues one profiles query instead of two
BR-003: PASS — answeredByName and revision changedByName still resolved (existing query tests pass)

## Files changed
lib/queries/brief.ts
missions/20260921-brief-redesign/handoffs/F016-handoff.md

## Commands run
`npx tsc --noEmit` (baseline LayoutProps error only)
`npx eslint lib/queries/brief.ts` (0)
`npx vitest run` f048-brief-query, f066, f067, f070 x2 (0; 32 tests pass)

## Decisions made
- The loadProfileNames result was NOT discarded: it fed answeredByName. Removing it would break behavior. The real redundancy was two sequential profiles queries, so I merged answered_by and changed_by ids into a single query.
- Profiles error now returns { ok:false } for the combined query (previously answerer lookup degraded silently, revisions lookup failed). No test asserted either.
- getBrief/getBriefForClient still use loadProfileNames (untouched).

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: merged queries rather than deleting the call, since the result is used.

## Notes for the next worker
No new test added; existing tests do not mock-count profile queries.
