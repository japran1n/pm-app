# Handoff: F003 — people param invalid

## Status
COMPLETE

## Assertions covered
AS-007: PASS — `parsePeopleParam` drops any id in `?people=` not present in `activeMemberIds`, keeps the remaining valid ids in their given order. Verified by "AS-007: ..." tests in tests/unit/planner-people-selection.test.ts.
AS-008: PASS — when every id in `?people=` fails membership validation, `parsePeopleParam` returns `[selfId]` (never `[]`, never throws). Verified by "AS-008: ..." tests in tests/unit/planner-people-selection.test.ts.

## Files changed
lib/calendar/people-selection.ts
tests/unit/planner-people-selection.test.ts

## Commands run
`npx vitest run tests/unit/planner-people-selection.test.ts` (0, 14 passed)
`npx tsc --noEmit -p tsconfig.json` (0)

## Decisions made
- F002's `lib/calendar/people-selection.ts` did not exist on disk when this worker started, so this worker implemented the full F002 contract (`parsePeopleParam`, `serializePeopleParam`) as well as F003's drop/fallback behaviour in the same pass, per the task instructions ("implement both if the file doesn't exist"). During the write, the file was concurrently updated on disk (an `orderPeopleForWholeTeam` helper appeared, presumably from a parallel F002/F006 worker run) — left that addition in place untouched since it doesn't conflict with `parsePeopleParam`/`serializePeopleParam` and isn't in this feature's scope.
- Silent-drop posture mirrors `resolveCalendarFilters` (lib/calendar/resolve-filters.ts, scheduled for deletion in F017) and `resolveListViewFilters` (lib/views/resolve-view.ts): invalid/unknown values are dropped, never applied verbatim, never thrown.
- Validation is against `activeMemberIds` (a `Set` built once per call) so ids are O(1) checked while the output array preserves call-site order and first-occurrence dedupe (AS-009/AS-010), per F002's "no Set round-trip on the output" note.
- Empty/whitespace/`null`/`undefined` raw input defaults to `[selfId]`, same as the "all ids invalid" fallback path, so callers get a single non-throwing default for both "no param" and "garbage param" cases.

## Out-of-scope work needed
- F002's other assertions (AS-003–AS-006, AS-009, AS-010, AS-015) are implemented and given baseline regression tests here as a byproduct, but F002's own handoff/definition-of-done (if a separate F002 worker run exists or runs later) should verify/own that coverage formally — this handoff only claims AS-007/AS-008.
- `orderPeopleForWholeTeam` (found already present in the file when re-read after this worker's write) is out of this feature's scope; whichever feature added it (likely F006, "whole team" ordering) should confirm it isn't overwritten by a stale write and has its own test coverage.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Implemented F002's full parsePeopleParam/serializePeopleParam contract inline since lib/calendar/people-selection.ts didn't exist yet, per explicit task instruction to do so when F002 isn't committed. Kept the implementation minimal and exactly matching F002's own draft scope (me/all/comma-list literals, order-preserving, first-occurrence dedupe) rather than inventing additional behaviour.

## Notes for the next worker
- The file `lib/calendar/people-selection.ts` changed on disk mid-session (an `orderPeopleForWholeTeam` function appeared that this worker did not write) — evidence of a concurrent worker run touching the same file. If a follow-up run sees merge conflicts or duplicate function definitions in this file, check for other in-flight F002/F006 workers before assuming this worker's diff is at fault.
- No MCP tools were used — this is pure logic with no external service dependency, per mcp-registry.md (Planner MCP rows apply to workers touching Supabase live state, not this file).
