# Handoff: F003 — Missing state + answered-by trail

## Status
COMPLETE

## Assertions covered
BR-015: PASS — star only when required && !isAnswered
BR-016: PASS — unanswered required shows "Not answered" with text-warning
BR-017: PASS — answered row shows "Name · relative" in font-mono text-xs

## Files changed
components/brief/team-answers-view.tsx
lib/queries/brief.ts
tests/unit/f003-missing-state-answered-by.test.tsx

## Commands run
`npx tsc --noEmit` (0 new errors after making field optional)
`npx vitest run tests/unit/f054-team-answers-view.test.tsx` (0)
`npx vitest run tests/unit/f0` (pre-existing unrelated failures: sidebar/page tests; baseline 129 failed vs 126 with change)

## Decisions made
- Name resolved via second select on profiles.display_name (same pattern as revisions; no FK to embed, no migration) in new loadProfileNames helper.
- answeredByName is optional on BriefAnswer to avoid editing ~10 existing test fixtures.
- Non-required unanswered rows keep "Not answered yet" muted text.

## Out-of-scope work needed
Pre-existing failing unit tests (sidebar, f025, f044, f045) unrelated to this feature.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: used display_name (not full_name) since profiles schema uses display_name.

## Notes for the next worker
Fallback name is "Someone" when profile lookup yields none.
