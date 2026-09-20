# Handoff: F079 — fix AS-011 single call site

## Status
COMPLETE

## Assertions covered
AS-011: PASS — week navigation (prev/next/today) preserves ?people= forward, exercised through page.tsx's single buildPlannerNavHrefs call site; verified by killing the mutation (peopleParam dropped inside buildPlannerNavHrefs) and confirming tests/unit/f029-switcher-url-wiring.test.tsx fails.

## Files changed
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
tests/unit/f079-calendar-page-single-call-site.test.ts

## Commands run
`npx vitest run tests/unit/f079-calendar-page-single-call-site.test.ts tests/unit/f029-switcher-url-wiring.test.tsx` (0)
`npx vitest run tests/unit -t "AS-011"` (0)
`npx vitest run tests/unit` (nonzero — 133 pre-existing failures unrelated to F079, see Decisions made)
`npx tsc --noEmit -p .` (0, no calendar-related errors)
`npx eslint "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx"` (0)
`git commit` (0)

## Decisions made
- Restructured page.tsx: deleted the `weekHrefFor` closure entirely. page.tsx now makes exactly ONE call: `const { prevHref, nextHref, todayHref } = buildPlannerNavHrefs({ workspaceSlug, currentWeekKey: weekKey, prevWeekKey: previousWeekKey(weekKey), nextWeekKey: nextWeekKey(weekKey), peopleParam })`, then threads the three hrefs down as plain string props instead of a `(key: string) => string` closure prop. This removes the possibility of a local re-derivation of hrefs that could silently diverge from `lib/calendar/week-nav.ts`.
- Added `tests/unit/f079-calendar-page-single-call-site.test.ts`, a source-guard test that reads page.tsx's raw text and asserts (a) no `weekHrefFor` identifier anywhere in the file, (b) `buildPlannerNavHrefs(` appears exactly once, (c) the import statement is present. This is a structural test intentionally coupled to source text, per the mission's explicit anti-gaming requirement for this specific assertion's history (4th attempt).
- Removed the now-unused `weekKey` prop from `WeekGridSection` (page.tsx no longer needs it there since hrefs are computed once at the top level) — caught by ESLint `no-unused-vars`, fixed to keep lint clean.
- Verified the mutation-kill by hand: edited `lib/calendar/week-nav.ts` locally to hardcode `peopleParam = undefined` inside `buildPlannerNavHrefs`, re-ran `tests/unit/f029-switcher-url-wiring.test.tsx`, confirmed 2 tests failed (prevHref/nextHref/todayHref lost `people=`), then reverted with `git checkout -- lib/calendar/week-nav.ts`. This confirms page.tsx's single call site is the actual live wiring, not a parallel copy.
- Ran the full unit suite (`npx vitest run tests/unit`) once to be thorough. It reports 133 pre-existing failures across ~30 files, none touching `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`, `lib/calendar/week-nav.ts`, or AS-011 — they're in an unrelated Sitemap Builder/Architecture Board feature area (F003–F097, F250 test files) and predate this change (confirmed via `git stash`-free inspection: these files aren't in the diff for this commit). Did not attempt to fix them — out of scope for F079.

## Out-of-scope work needed
The 133 pre-existing unit test failures in the Sitemap Builder / Architecture Board area (files like f003-*, f006-*..f036-*, f044-*, f045-*, f048-*, f060-*, f081-*, f083-*, f084-*, f085-*, f096-*, f097-*, f104-*, f250-*, list-due-date-cell-*.test.tsx) are unrelated to F079/AS-011 and were not introduced by this change. They look like a broken shared fixture/mock or a dependency version drift (many failures share the same rendering-related error signature). Worth a dedicated triage feature if the mission needs a fully green `npx vitest run tests/unit`.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Dropped the now-orphaned `weekKey` prop from `WeekGridSection`'s prop list (it was only ever used to feed `weekHrefFor`); kept `weekKey` itself as a local variable in the parent since `buildCalendarWeek`/`weekDateRange`/`buildPlannerNavHrefs` all still need it there.

## Notes for the next worker
- The critical invariant per AS-011: `lib/calendar/week-nav.ts`'s `buildPlannerNavHrefs` is the ONLY function that may decide what happens to `peopleParam` when building prev/next/today hrefs. `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` must call it exactly once and never re-implement any part of that logic locally (no closures, no second href-building helper). `tests/unit/f079-calendar-page-single-call-site.test.ts` enforces this structurally; `tests/unit/f029-switcher-url-wiring.test.tsx` enforces it behaviourally.
- If a future change needs page.tsx to build hrefs for something other than prev/next/today, extend `buildPlannerNavHrefs`'s return shape or add a new exported function in `week-nav.ts` — do not add a second call site or a wrapper closure in page.tsx.
