# Handoff: F071 — Fix AS-011 — extract href derivation to pure function, test it

## Status
COMPLETE

## Assertions covered
AS-011: PASS — `buildWeekNavHref` (already an extracted pure function in `lib/calendar/people-selection.ts`) is now tested end-to-end with real href strings mirroring page.tsx's exact call shape (`weekHrefFor` closure and `todayHref`). Verified via a manual mutation check (temporarily forcing `peopleParam = undefined` inside `buildWeekNavHref`) that 4 of the AS-011 tests fail as expected, then reverted.

## Files changed
tests/unit/f029-switcher-url-wiring.test.tsx

## Commands run
`npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx` (0)
`npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx tests/unit/planner-people-selection.test.ts` (0)
`npx vitest run` (0, but 292 pre-existing failing test files unrelated to this change — see Notes)
Manual mutation check: `sed`-patched `buildWeekNavHref` to ignore `peopleParam`, ran targeted test file, observed 4 failures, restored file from `.bak`, re-ran to confirm 11/11 pass again.

## Decisions made
- `buildWeekNavHref` already existed in `lib/calendar/people-selection.ts` as a pure function (added by F029), and the top of `tests/unit/f029-switcher-url-wiring.test.tsx` already contained real href-string assertions against it (`prevHref`/`nextHref`/`todayHref` `.toBe(...)` checks with an actual `people=` query value). Those were untouched — they already satisfy "test receives a real href string and asserts the `?people=` query param value."
- The only gameable part was the F067-added `describe("F067 (AS-011): calendar page.tsx call sites...")` block at the bottom of the same file, which read `page.tsx` source text and regex-matched for the literal `peopleParam` identifier near each `buildWeekNavHref(...)` call. That block is deleted per spec instruction ("Also delete the F067 source-regex test that is now superseded").
- Replaced it with a new `describe("F071 (AS-011): week nav hrefs carry a real, correct ?people= value end-to-end")` block containing two tests that reconstruct page.tsx's exact `weekHrefFor`/`todayHref` wiring shape (a closure capturing `peopleParam` from the resolved `searchParams`, calling `buildWeekNavHref` per nav link) and assert on the **parsed** `URL.searchParams.get("people")` value of the real returned href — not source text.
- Did NOT add a third test that calls `buildWeekNavHref({ peopleParam: undefined })` and asserts the value is still present (that would be an always-failing test committed to the suite — nonsensical). Instead, per the "Mutation:" line in the Gate section, I performed the peopleParam=undefined mutation manually against the real `buildWeekNavHref` implementation, confirmed the AS-011 tests fail, then reverted. This is the correct reading of "the test must fail when peopleParam arg is ignored" — a mutation-testing style verification of the test suite's sensitivity, not a permanently-failing assertion in the committed file.
- Did not touch `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` — spec's "Touches" is the test file (and `lib/calendar/week-nav.ts`/`people-selection.ts` only if the pure function didn't already exist, which it did).

## Out-of-scope work needed
None identified for this feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "the test must fail when peopleParam is ignored (set it to undefined) inside the function" as a mutation-testing gate check to be performed and reported (per the spec's own "Gate" section: "Mutation: inside buildWeekNavHref, set peopleParam=undefined -> test MUST FAIL"), not as literal code to add to the committed test file. Performed the mutation manually via a scripted sed edit + test run + revert, and confirmed 4 AS-011 tests correctly fail under that mutation.

## Notes for the next worker
- `npx vitest run` (full suite) shows 292 failing test files / 310 failing tests, entirely unrelated to this change (e.g. `list-due-date-cell-optimistic.test.tsx`, `project-settings-nav.test.tsx` — DOM text-content/timer assertion mismatches in unrelated features). My target test file (`f029-switcher-url-wiring.test.tsx`) does not appear anywhere in the failure output and passes cleanly both in isolation and within the full run. These failures predate this feature and should be tracked separately if not already known to the orchestrator.
- No MCP tools were needed for this feature — pure client-side/unit-test logic only, no external service state involved.
