# Handoff: F088 — lift PeopleSwitcherUrlBound header above layout branch

## Status
COMPLETE

## Assertions covered
AS-011: PASS — week nav (prev/next/today) hrefs still preserve `?people=`, now via the shared `<PlannerHeader>`'s rendered `<a href>` attributes (tests/unit/f080-calendar-nav-hrefs.test.tsx).
AS-012: PASS — selecting people still pushes a URL preserving `?week=`; PeopleSwitcherUrlBound's own wiring is unchanged (tests/unit/f029-switcher-url-wiring.test.tsx).
AS-013: PASS — no browser storage use, unchanged (tests/unit/f029-switcher-url-wiring.test.tsx source scan, still covers page.tsx/week-view.tsx/people-switcher.tsx).
AS-051: PASS — the switcher renders in the same header row as the nav controls; now exercised against `<PlannerHeader>` directly, the component that actually owns that row today (tests/unit/people-switcher-placement-a11y.test.tsx).
AS-059: PASS — deselecting the only member falls back to self; unchanged, PeopleSwitcherUrlBound's own logic untouched (tests/unit/f029-switcher-url-wiring.test.tsx).
AS-062: PASS — StackedPlanner's row labels still come from the same `peopleSwitcherMembers`/`switcherMembers` list threaded from page.tsx (tests/unit/f032-stacked-shell.test.tsx, tests/unit/f088-planner-header-lift.test.tsx).

## Files changed
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
components/calendar/week-view.tsx
components/calendar/planner-header.tsx (new)
lib/calendar/week-grid.ts
tests/unit/calendar-week-only-view.test.tsx
tests/unit/f015-remove-task-strips.test.tsx
tests/unit/f020-ownership-predicate.test.ts
tests/unit/f080-calendar-nav-hrefs.test.tsx
tests/unit/people-switcher-placement-a11y.test.tsx
tests/unit/f088-planner-header-lift.test.tsx (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/f088-planner-header-lift.test.tsx` (0)
`npx vitest run tests/unit/calendar-week-only-view.test.tsx tests/unit/f015-remove-task-strips.test.tsx tests/unit/f016-calendar-page-no-task-query.test.ts tests/unit/f020-ownership-predicate.test.ts tests/unit/f029-switcher-url-wiring.test.tsx tests/unit/f031-page-layout-derivation.test.tsx tests/unit/f032-stacked-shell.test.tsx tests/unit/f080-calendar-nav-hrefs.test.tsx tests/unit/people-switcher-placement-a11y.test.tsx tests/unit/f088-planner-header-lift.test.tsx` (0, all 10 files/59 tests pass)
`npx vitest run tests/unit/` (135 failed / 3308 passed — all 135 failures are pre-existing, in unrelated CMS/board/list files (e.g. f003-page-client-visibility-toggle, list-due-date-cell-optimistic, f009-board-layout, ...), none touch calendar/planner/switcher/week-view; confirmed via `git status --porcelain` that none of those failing test files are among my changed files)

## Decisions made
- Extracted `formatWeekRangeLabel` out of week-view.tsx into `lib/calendar/week-grid.ts` (exported) so both the new `<PlannerHeader>` (in page.tsx) and any future caller can format the week label without duplicating the Intl.DateTimeFormat logic WeekView used to own privately.
- Created `components/calendar/planner-header.tsx` as a new shared Server Component containing exactly the markup that used to live inside WeekView's header div: the `<h1>` week label, the optional `PeopleSwitcherUrlBound`, the optional `AddTimeOffDialog`, and the prev/today/next `<Button>`+`<Link>` trio. Same prop shapes as WeekView previously accepted (`peopleSwitcher?: {...}`), so no caller-facing contract changed beyond "which component you pass these props to."
- `WeekView` no longer accepts `prevHref`/`nextHref`/`todayHref`/`peopleSwitcher` at all (removed from its prop type, not just left unused) — per the spec's "both branches render their content body WITHOUT the switcher" instruction, the header genuinely doesn't belong in WeekView any more, not just "shown elsewhere too."
- Relocated the header-behavior test coverage that used to render `<WeekView>` directly (people-switcher-placement-a11y.test.tsx AS-051, f080-calendar-nav-hrefs.test.tsx AS-011 rendered-href checks) to render `<PlannerHeader>` instead, since that's the component that now actually owns that markup. Removed one WeekView-specific "Today link" test from calendar-week-only-view.test.tsx (its coverage is superseded by the PlannerHeader-based f080 tests) and pointed its doc comment at the new location.
- While implementing, discovered a concurrently-landed F035 (drag-to-reorder for StackedPlanner rows) had added `workspaceSlug`/`selfId`/`weekParam` props to `StackedPlanner` (for `router.replace` persistence on reorder) that page.tsx wasn't yet passing through post-refactor. Restored those three props on the `<StackedPlanner>` call site and threaded `weekParam` through `WeekGridSection` so this header-lift fix doesn't silently regress F035's reorder persistence. AUTONOMOUS_DECISION: kept F035's props intact rather than dropping them, since removing them would break reorder-persistence with no test signal in this feature's own scope (StackedPlanner's own drag tests are out of scope here).
- Added `vi.mock("next/navigation")` to the new f088 test file's StackedPlanner render, matching F035's addition of `useRouter()` inside StackedPlanner.

## Out-of-scope work needed
None identified beyond what's already covered by other features (F035's drag-reorder is already landed/owned elsewhere; this handoff only restored its prop wiring after the header-lift refactor, didn't add new behavior to it).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Restored `StackedPlanner`'s `workspaceSlug`/`selfId`/`weekParam` props (added by a concurrently-landed F035) on page.tsx's call site after the header-lift refactor, rather than leaving them dropped — dropping them would have silently disabled F035's drag-to-reorder URL persistence, which is outside this feature's stated scope to touch but also not something this fix should regress.

## Notes for the next worker
- `components/calendar/planner-header.tsx` is the new single source of truth for the Planner's header row. Any future change to week-nav/label/switcher/add-time-off markup belongs there, not in WeekView or StackedPlanner.
- The full `npx vitest run tests/unit/` run has 135 pre-existing failures unrelated to this feature (CMS board/section/page/list-cell tests) — do not treat those as caused by this change; none of the failing files were touched here.
- No MCP tools were needed for this feature (pure client/server-component UI refactor, no external service state).
