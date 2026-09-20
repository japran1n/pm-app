# Handoff: F006 — whole-team ordering

## Status
COMPLETE

## Assertions covered
AS-058: PASS — `orderPeopleForWholeTeam` orders selfId first, then remaining members alphabetically by name (localeCompare), with null names sorting last. Verified via `tests/unit/planner-people-selection.test.ts`.

## Files changed
lib/calendar/people-selection.ts
tests/unit/planner-people-selection.test.ts

## Commands run
`npx vitest run tests/unit/planner-people-selection.test.ts` (0) — 17 passed (14 pre-existing F002/F003 tests + 3 new AS-058 tests)
`npm test` (0, per background task notification) — full suite has a large number of pre-existing failures unrelated to this feature (see Notes)
`git commit` (0)

## Decisions made
- Found that `lib/calendar/people-selection.ts` already existed (created by a concurrently-run F003 worker) with `parsePeopleParam`/`serializePeopleParam`. Appended `orderPeopleForWholeTeam` to the existing file rather than overwriting it, per spec instruction to "append to it" if F002/F003 already ran.
- Implemented `orderPeopleForWholeTeam(members, selfId)`: filters self out, sorts the remainder with `String.prototype.localeCompare` on `name`, treating `null` names as sorting after any non-null name (stable for members with identical/null names since `Array.prototype.sort` in modern V8/Node is stable).
- Initially overwrote `tests/unit/planner-people-selection.test.ts` with only my new tests via `Write`, which would have destroyed F003's existing AS-007/AS-008/etc. tests already committed on `main`. Caught this via `git diff` showing no changes to the source file and an unexpected full-file diff on the test file, restored the original with `git checkout --`, and re-applied my 3 AS-058 tests as an additive `describe` block plus an updated import line. Final file has all 17 tests (14 original + 3 new) passing.

## Out-of-scope work needed
None for this feature. The "whole team" shortcut UI wiring (F028) and the default stacked order consumer are out of scope per the spec's own notes and belong to those features.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `Array.prototype.sort`'s guaranteed stability (ES2019+, true in the Node/V8 versions this repo targets) to satisfy the spec's "stable for members sharing a name" requirement, rather than adding a manual index-based tiebreaker — simpler and equivalent given the runtime guarantee.

## Notes for the next worker
- `npm test` on this checkout currently has a very large number of pre-existing failures unrelated to F006: DB/RLS integration tests that need a live Supabase connection (they fail immediately with connection/schema errors), plus many unrelated UI unit test suites (component panel, hover highlighting, rename/delete panel, CMS badge, keyboard accessibility, due-date cell optimistic UI, etc.) that were already broken before this feature's changes. None of these touch `lib/calendar/people-selection.ts` or the Planner people-selection logic. I verified my change in isolation with `npx vitest run tests/unit/planner-people-selection.test.ts`, which is clean (17/17 passing).
- Be aware other F00x workers may be running concurrently against the same files in this mission (F002/F003/F004/F005 commits are all interleaved in recent git log, all touching `lib/calendar/`). Always `git diff`/`git checkout` before using `Write` to fully overwrite a shared file — prefer `Edit` for targeted appends to avoid clobbering a concurrent worker's committed changes, which is exactly what happened here and was caught before commit.
- No MCP usage required — this is pure logic with no external service interaction.
