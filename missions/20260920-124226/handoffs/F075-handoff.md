# Handoff: F075 — Fix AS-011: refactor page.tsx href building so tests observe real call sites

## Status
COMPLETE

## Assertions covered
AS-011: PASS — Extracted `buildPlannerNavHrefs` into `lib/calendar/week-nav.ts`, made `page.tsx` call it directly (threading `peopleParam` through), and added tests in `tests/unit/f029-switcher-url-wiring.test.tsx` that call `buildPlannerNavHrefs` directly plus a source guard confirming `page.tsx` imports/calls it with `peopleParam`. Verified the mutation `peopleParam = undefined` inside `buildPlannerNavHrefs` fails 2 of the new tests (prevHref/nextHref/todayHref lose `?people=`), then reverted.

## Files changed
lib/calendar/week-nav.ts (new)
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
tests/unit/f029-switcher-url-wiring.test.tsx (edits were already present in HEAD at commit bec670d0 due to a concurrent worker process sharing this checkout — content verified identical to what I wrote; see Notes)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (1, pre-existing unrelated warning in tests/unit/people-switcher-placement-a11y.test.tsx — not a file I touched, not introduced by this change)
`npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx` (0, 15/15 passed)
Mutation check: set `peopleParam = undefined` inside `buildPlannerNavHrefs` → 2 of the new F075 tests failed as expected (prevHref/nextHref lost `?people=`), then reverted; re-ran suite → 15/15 passed again.
`git commit` (0)

## Decisions made
- Extracted the href-building logic into `lib/calendar/week-nav.ts` as `buildPlannerNavHrefs`, matching the exact signature specified in the feature spec (workspaceSlug, currentWeekKey, prevWeekKey, nextWeekKey, peopleParam) rather than inlining a duplicate helper.
- `buildPlannerNavHrefs` calls `buildWeekNavHref` (from `lib/calendar/people-selection.ts`) internally for each of prevHref/nextHref/todayHref rather than reimplementing URL construction, per the spec's "This function must call `buildWeekNavHref`" instruction.
- In `page.tsx`, `weekHrefFor(key)` now calls `buildPlannerNavHrefs({...prevWeekKey: key, nextWeekKey: key...}).prevHref` — since the existing call site only needs one href per call (the caller passes either `previousWeekKey(weekKey)` or `nextWeekKey(weekKey)` as `key`), using `.prevHref` for both is functionally identical (it's the same `buildWeekNavHref` call regardless of which field name is read). Chose not to restructure page.tsx's existing `weekHrefFor` closure shape since the spec's Step 2 only requires "use this function," not a full navigation-model rewrite.
- Kept `todayHref` as a separate `buildPlannerNavHrefs(...).todayHref` call for clarity, matching Step 2's requirement that `peopleParam` reaches every nav href.
- Step 3 tests assert `todayHref` also contains `people=` when `peopleParam` is present (the spec allowed either behavior as long as it's derived from `peopleParam`, not ignored) — matches existing `buildWeekNavHref` semantics already covered by the pre-existing AS-011 tests.
- Discovered mid-task that another concurrent worker process (F077, committed as bec670d0) had already committed my in-progress edits to `tests/unit/f029-switcher-url-wiring.test.tsx` as a side effect of sharing the same working-tree checkout. Verified via `diff` that HEAD's copy of the test file is byte-identical to what I authored, so no content was lost or altered. Committed only the two files that weren't already captured (`lib/calendar/week-nav.ts`, `page.tsx`) under this feature's own commit.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `.prevHref` field from `buildPlannerNavHrefs` for both the "previous week" and "next week" call sites inside `page.tsx`'s existing `weekHrefFor(key)` closure, since both call sites only need a single href derived from one week key and `peopleParam` — reading `.prevHref` vs `.nextHref` produces byte-identical output either way given they both call `buildWeekNavHref({ workspaceSlug, weekKey: <passed key>, peopleParam })` internally. Chose not to restructure `weekHrefFor`'s single-href-per-call shape since the spec's scope was "use this function," not a full call-site redesign.

## Notes for the next worker
- `lib/calendar/week-nav.ts` is the new source of truth for AS-011 nav-href construction (`buildPlannerNavHrefs`). Any future change to how `?people=` is carried through week navigation should live there, not be reintroduced inline into `page.tsx`.
- The Step 4 source guard in `tests/unit/f029-switcher-url-wiring.test.tsx` regex-checks that `page.tsx` imports `buildPlannerNavHrefs` from `@/lib/calendar/week-nav` and calls it with `peopleParam` in scope. If `page.tsx` is refactored again, keep that import/call shape or update the regex deliberately.
- Repo note: this checkout appears to be shared by multiple concurrent worker processes during this run (F075 and F077 landed near-simultaneously and a commit made by the F077 process absorbed my test-file edits). Not something I could control from inside a single worker; flagging so the orchestrator is aware if commit attribution across F075/F077 looks unusual in the log.
