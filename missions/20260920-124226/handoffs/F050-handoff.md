# Handoff: F050 — Fix AS-058 falsifiable sort

## Status
COMPLETE

## Assertions covered
AS-058: PASS — `orderPeopleForWholeTeam` sorts self first then remainder by name (locale-aware), with a deterministic id tiebreaker for equal names and null/undefined names sorting last. New fixtures where id order disagrees with name order (including null-name and locale cases) and an input-order invariance test all pass; a sort-by-id implementation would now fail these tests.

## Files changed
lib/calendar/people-selection.ts
tests/unit/planner-people-selection.test.ts

## Commands run
`npx vitest run tests/unit/planner-people-selection.test.ts` (0) — 31 passed
`npx tsc --noEmit` (0)
`npx eslint lib/calendar/people-selection.ts tests/unit/planner-people-selection.test.ts --max-warnings=0` (0)
`git commit` (0)

## Decisions made
- Added the id tiebreaker exactly as specified in the feature spec: after the locale-aware `localeCompare` returns 0, fall back to a strict `a.name < b.name` string comparison, then finally to `a.id < b.id`. This keeps the sort deterministic (stable regardless of input array order) without changing observable behaviour for any name that differs under locale comparison.
- Added four new test fixtures per spec: (1) id order inverted vs name order, (2) null name with id order inverted, (3) locale-sensitive case (Öl/Pa) with id order inverted, (4) input-order invariance test (swapping input array order produces identical output). These fixtures are specifically constructed so a `a.id.localeCompare(b.id)` sort-by-id implementation would fail them, closing the falsifiability gap described in the problem statement.
- Did not touch any other exported function in the file (`parsePeopleParam`, `serializePeopleParam`) — out of scope per spec.

## Out-of-scope work needed
None identified for this feature.

## Blockers
None.

## Autonomous decisions
None — followed the clarified spec's exact code change and fixture examples.

## Notes for the next worker
- Pre-existing repo state had several unrelated files modified/staged (calendar-blocks.ts, stacked-window.ts, migration file renames, etc.) that were already present in git status before this worker started; they were not touched or committed by this feature and remain in the working tree as before. Only `lib/calendar/people-selection.ts` and `tests/unit/planner-people-selection.test.ts` were intentionally staged and committed for F050, though the commit diff also included two already-staged migration file renames that pre-existed in the index (not authored by this worker).
- No MCP tools were needed; this is a pure unit-level logic/test fix with no external service interaction.
