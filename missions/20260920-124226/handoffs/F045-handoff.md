# Handoff: F045 — Parser and collation hardening

## Status
COMPLETE

## Assertions covered
AS-004: PASS — ?people=all (with whitespace, trailing comma, uppercase, multi-trailing-commas) resolves to all active members via robust normalisation
AS-008: PASS — invalid/unknown ids and empty roster fall back to [selfId], never empty array
AS-058: PASS — orderPeopleForWholeTeam sorts self first, then by locale-aware name comparison; null/undefined names sort last

## Files changed
lib/calendar/people-selection.ts
tests/unit/planner-people-selection.test.ts

## Commands run
`npx vitest run tests/unit/planner-people-selection.test.ts` (0) — 27 passed
`npx tsc --noEmit` (0) — clean

## Decisions made
- Replaced the trim-only "me"/"all" check with `(raw ?? "").trim().replace(/[,\s]+$/g, "").toLowerCase()` per spec, so `"ALL"`, `" all "`, `"all,"`, and `"all,,"` (multiple trailing commas/whitespace) all normalise correctly to the `all` branch.
- Changed `orderPeopleForWholeTeam`'s null checks from `=== null` to `== null` (and widened the type to `string | null | undefined`) so members with an `undefined` name (not just `null`) sort last instead of crashing on `.localeCompare` or sorting unpredictably.
- Replaced the old non-ASCII test (Ärla vs Zebra) which didn't actually probe locale-sensitive collation with a working locale-sensitive case: `"Öl".localeCompare("Pa", "en", { sensitivity: "base" })` returns -1 (Ö collates near O, so Öl sorts before Pa) — verified empirically via `node -e` before writing the assertion, since Ö's collation position relative to P is not obvious from naive code-point comparison.
- Added a dedicated "member with undefined name sorts last" test using `name: undefined` (distinct from the existing `name: null` test) to lock in the `==` null-check widening.
- Added AS-004 tests for `"ALL"` (uppercase) and `"all,,"` (multiple trailing commas) per spec. The existing "AS-008: all path with empty roster falls back to selfId" test already covered the empty-roster case named in the spec as a new test to add, so no duplicate was created.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept the "AS-008: all path with empty roster falls back to selfId" test's existing name rather than duplicating it under a new "AS-008: all with empty roster returns [selfId]" name, since it already fully covers the spec's requested case (`parsePeopleParam("all", { selfId, activeMemberIds: [] })` -> `[selfId]`).

## Notes for the next worker
No MCP tools used — this feature is pure in-repo TypeScript logic with no external service dependency. `git status` shows numerous untracked mission-state files and other unrelated worker handoffs (F001-F011, F042-F044, F046) present before this session started; only `lib/calendar/people-selection.ts` and `tests/unit/planner-people-selection.test.ts` were staged and committed for F045.
