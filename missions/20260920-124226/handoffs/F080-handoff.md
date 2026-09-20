# Handoff: F080 — Fix AS-011 — render component, assert real href attributes contain ?people=

## Status
COMPLETE

## Assertions covered
AS-011: PASS — `tests/unit/f080-calendar-nav-hrefs.test.tsx` renders the real `WeekView` component (the one `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` actually mounts via `WeekGridSection`) with real `prevHref`/`nextHref`/`todayHref` strings and asserts on the rendered `<a href>` attribute values via `getByRole("button", { name: ... })` (Base UI's `Button` renders a real `<a>` with `role="button"` override — confirmed by inspecting the DOM output). Also verified with the two required mutations (see below), both of which FAIL as required.

## Files changed
tests/unit/f080-calendar-nav-hrefs.test.tsx (new)
tests/unit/f029-switcher-url-wiring.test.tsx (deleted the old token-presence regex guard describe block "F075: page.tsx's source guard -- must call buildPlannerNavHrefs"'s `peopleParam` regex assertion, replaced with a comment pointing to the new test; kept the rest of the file, including its own value-level `buildPlannerNavHrefs` tests, untouched)
tests/unit/f079-calendar-page-single-call-site.test.ts (deleted — superseded by the href-render test per spec Step 4; `tests/unit/f079-doc-invisible.test.ts` is unrelated (AS-162) and was left alone)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint tests/unit/f080-calendar-nav-hrefs.test.tsx tests/unit/f029-switcher-url-wiring.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/f080-calendar-nav-hrefs.test.tsx tests/unit/f029-switcher-url-wiring.test.tsx` (0, 20/20 passed)
`npx vitest run` (0 exit code from vitest itself; 292/872 pre-existing failing test files across the repo, unrelated to this feature — see Notes)
Mutation 1 — `lib/calendar/week-nav.ts`: hardcoded `const peopleParam = undefined;` inside `buildPlannerNavHrefs` → `tests/unit/f029-switcher-url-wiring.test.tsx`'s existing F075 `buildPlannerNavHrefs` tests FAIL as required (2 failures: prev/next and today hrefs no longer contain `people=`). File restored via diff-verified copy afterward.
Mutation 2 — `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`: changed the `buildPlannerNavHrefs({...})` call's `peopleParam,` to `peopleParam: undefined,` → `tests/unit/f080-calendar-nav-hrefs.test.tsx`'s `test_AS_011_page_passes_people_param_to_nav_hrefs` FAILS as required. File restored via diff-verified copy afterward (confirmed `diff` reports no difference from the pre-mutation backup).

## Decisions made
- Traced the prop chain: `page.tsx` → `WeekGridSection` (local, same-file) → `WeekView` (`components/calendar/week-view.tsx`). `WeekView` is the component that actually renders `<Link href={prevHref}>`/`<Link href={todayHref}>`/`<Link href={nextHref}>` wrapped in the design system's `Button` (`nativeButton={false}`, `render={<Link .../>}`), so it's the correct render target for a DOM-level href assertion.
- Discovered mid-implementation that the design system's `Button` component sets `role="button"` on the rendered `<a>` (overriding the implicit `link` role) — confirmed by dumping the accessible-roles tree from `@testing-library/dom`'s error output. Queried with `getByRole("button", { name: /previous week/i })` etc. instead of `getByRole("link", ...)`; the element under test is still the real `<a href="...">` DOM node, so `toHaveAttribute("href", ...)` still asserts on the genuine rendered href attribute — Step 3 of the spec's DOD is satisfied regardless of ARIA role.
- The source-level backup guard (Step 2's second test in the spec) needed `[\s\S]*?` (non-greedy any-char) instead of `[^)]*` between `buildPlannerNavHrefs({` and `peopleParam:` — the object literal contains `previousWeekKey(weekKey)`/`nextWeekKey(weekKey)` calls before `peopleParam`, each with their own `)`, so `[^)]*` stopped too early and silently passed on both an unmutated and a mutated call site. Verified the fixed regex against both states directly with `node -e` before trusting it in the test.
- Deleted only the specific regex assertion from f029's "F075: page.tsx's source guard" describe block, not the whole file — the rest of that file (AS-012, AS-013, AS-059 tests, and the value-level `buildPlannerNavHrefs` F075 tests that mutation 1 above exercises) are legitimate, already-passing, non-regex-guard coverage for other assertions and must stay.

## Out-of-scope work needed
None identified for this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Queried the rendered anchors by `role="button"` rather than `role="link"` because the codebase's `Button` design-system component (per CLAUDE.md's Supabase Design System interaction rules) overrides the implicit anchor role. This is a query-strategy choice only — the assertions still run against the real DOM `<a href>` attribute, satisfying the spec's "no regex over source text as the primary guard" requirement.

## Notes for the next worker
- `npx vitest run` (full suite) reports 292/872 test files failing repo-wide (e.g. `tests/unit/list-due-date-cell-optimistic.test.tsx`) — none of these failures reference this feature's files (`f080-calendar-nav-hrefs`, `f029-switcher-url-wiring`, `week-nav.ts`, `page.tsx`, `week-view.tsx`) and they pre-date this change (confirmed by grepping the failure output for this feature's test file names — zero matches). This is pre-existing breakage in the repo, not something this feature introduced; flagging so a future milestone can investigate separately.
- If AS-011 needs re-verification in the future: run `npx vitest run tests/unit/f080-calendar-nav-hrefs.test.tsx tests/unit/f029-switcher-url-wiring.test.tsx` in isolation — both pass cleanly (20/20).
