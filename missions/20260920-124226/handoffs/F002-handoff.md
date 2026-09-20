# Handoff: F002 — people param parse

## Status
COMPLETE

## Assertions covered
AS-003: PASS — "AS-003: ?people=me resolves to the signed-in member" in tests/unit/planner-people-selection.test.ts
AS-004: PASS — "AS-004: ?people=all resolves to every active member of the workspace"
AS-005: PASS — "AS-005: ?people=<memberId> shows only that member"
AS-006: PASS — "AS-006: a comma-separated list shows exactly those members"
AS-009: PASS — "AS-009: the sequence of ids is preserved exactly as given, not alphabetised"
AS-010: PASS — "AS-010: an id repeated in ?people= produces exactly one selected person"
AS-015: PASS — "AS-015: parsePeopleParam's result depends only on the people param, selfId, and activeMemberIds — an unrelated 'view' key changes nothing" (added by this worker; module exports no view-related reader/writer)

## Files changed
lib/calendar/people-selection.ts (pre-existing on disk from concurrent F003 work at start of this task; left unmodified — see Notes)
tests/unit/planner-people-selection.test.ts (added AS-015 coverage; AS-003/004/005/006/009/010 coverage already present from concurrent F003 work)

## Commands run
`npx vitest run tests/unit/planner-people-selection.test.ts` (0) — 18/18 tests pass
`npx vitest run tests/unit` (ran; 41 pre-existing unrelated failing test files / 133 failing tests across the wider suite, none touching lib/calendar/people-selection.ts or tests/unit/planner-people-selection.test.ts — these failures predate this feature and are out of scope)
`npx tsc --noEmit -p tsconfig.json` (0 errors reported for lib/calendar/people-selection.ts)

## Decisions made
- On starting this task, `lib/calendar/people-selection.ts` and `tests/unit/planner-people-selection.test.ts` already existed on disk, apparently written concurrently by the F003 worker (AS-007/AS-008, same module/file). The implementation already fully satisfied this feature's assertions (AS-003, AS-004, AS-005, AS-006, AS-009, AS-010) plus F003's. Rather than overwrite and risk clobbering F003's work or thrashing on a shared file, I kept the existing implementation and only added the one missing test (AS-015), which had been dropped by a subsequent concurrent overwrite of the test file mid-task.
- The disk implementation uses `activeMemberIds: readonly string[]` instead of the `ReadonlySet<string>` specified in the clarified spec's draft signature. Functionally equivalent for every assertion in scope (membership check via an internal `new Set(activeMemberIds)`, order preserved via array, not the Set). Did not revert to `ReadonlySet<string>` because doing so would conflict with F003's already-landed, already-tested implementation of the same exported function.
- AS-015 verified structurally: `parsePeopleParam`'s only inputs are `raw`, `selfId`, `activeMemberIds`; passing an unrelated `view` key in the options object is proven to change nothing about the result. No `?view=` parameter is read anywhere in `lib/calendar/people-selection.ts`.
- No `?view=` parameter is read or produced anywhere in this module (confirmed by reading the full file).

## Out-of-scope work needed
None identified beyond this feature's scope. F003 (AS-007, AS-008: silent-drop of invalid ids, fallback-to-self) and an `orderPeopleForWholeTeam` helper (AS-058) already landed in the same file/test file by a concurrent worker; not this feature's concern.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept the pre-existing `readonly string[]` signature for `activeMemberIds` (rather than the `ReadonlySet<string>` named in the draft spec) because a concurrent worker (F003) had already implemented and tested the same exported function against that signature in the shared file. Reverting would have broken F003's already-passing tests for no functional benefit — every assertion assigned to F002 passes identically under either representation.
AUTONOMOUS_DECISION: Re-added the AS-015 test after it was dropped by a second concurrent overwrite of the shared test file during this task, to ensure the assertion assigned to F002 has explicit coverage rather than relying on incidental absence-of-view-code.

## Notes for the next worker
- `lib/calendar/people-selection.ts` and `tests/unit/planner-people-selection.test.ts` are shared with F003 (and apparently F058-related work). Expect concurrent edits if working near this file during the same run window; re-check the file before editing rather than assuming your last read is current.
- No MCP tools were used — this is pure logic with no external service touched.
