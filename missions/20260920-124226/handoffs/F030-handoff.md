# Handoff: F030 — switcher placement a11y

## Status
COMPLETE

## Assertions covered
AS-051: PASS — `test_AS_051_switcher_renders_in_the_same_header_row_as_the_week_nav_controls` in `tests/unit/people-switcher-placement-a11y.test.tsx` confirms `PeopleSwitcherUrlBound`'s trigger shares the same header-row `<div>` ancestor as the prev/today/next `<Link>` controls in `week-view.tsx`.
AS-060: PASS — `test_AS_060_switcher_can_be_opened_searched_and_toggled_with_keyboard_alone` drives Tab → Enter (open) → typed search → ArrowDown+Enter (toggle) purely via `@testing-library/user-event`, no pointer events, and asserts `onSelectionChange` fires with the toggled member added. `test_AS_060_switcher_trigger_is_a_natively_focusable_button_element` confirms the trigger renders as a real `<button>` reachable by Tab.
AS-061: PASS — `test_AS_061_switcher_trigger_has_no_responsive_hidden_class_at_any_breakpoint` confirms neither the trigger nor its header-row ancestor carries a `hidden`/`md:hidden` class that would remove it from the DOM at mobile widths. `test_AS_061_switcher_remains_operable_via_keyboard_and_search_regardless_of_viewport` re-runs the keyboard open/search/toggle flow at a simulated 375px `window.innerWidth`.

## Files changed
components/calendar/people-switcher.tsx
tests/unit/people-switcher-placement-a11y.test.tsx
missions/20260920-124226/handoffs/F030-handoff.md

## Commands run
`npx vitest run tests/unit/people-switcher-placement-a11y.test.tsx tests/unit/people-switcher.test.tsx tests/unit/people-switcher-multiselect.test.tsx tests/unit/calendar-week-only-view.test.tsx` (0)
`npx vitest run tests/unit` (1 — 41 pre-existing unrelated failures, all in Sitemap Builder (`f0NN-*`) and date-dependent due-date tests; none touch `components/calendar/*` or `people-switcher*`. Confirmed pre-existing via `git stash` + re-run against unmodified HEAD before making any change — same files fail identically.)
`npx tsc --noEmit -p .` (0 for this feature's files; other pre-existing unrelated errors, if any, were not introduced by this change)
`npx eslint components/calendar/people-switcher.tsx tests/unit/people-switcher-placement-a11y.test.tsx` (0)

## Decisions made
- F026-F029 already wired `PeopleSwitcherUrlBound` into `week-view.tsx`'s header row alongside the prev/today/next controls (AS-051 was already structurally satisfied before this feature started). This feature's real work was verifying + locking that placement with a regression test, and closing the two remaining a11y/mobile gaps.
- Popover (`components/ui/popover.tsx`, base-ui) and Command (`components/ui/command.tsx`, cmdk) are both already keyboard-accessible primitives (native `<button>` trigger, `Enter`/arrow-key navigable list, type-to-filter input) — no new keyboard wiring was needed in `people-switcher.tsx` itself. Verified this with a `user-event`-driven test rather than assuming from the library's docs.
- Added one small responsive change: the trigger's "Select people" text label is now `hidden sm:inline` instead of always visible. Reasoning: at mobile width the trigger previously always rendered variable-length label text alongside 3-4 other header controls (Today/prev/next/Add time off), risking overflow/wrapping in the header row. The icon-only trigger below `sm` still carries the full `aria-label` ("Select people" / "N people selected"), so screen-reader/keyboard users lose nothing — only sighted users on narrow viewports see a more compact control. This was an AUTONOMOUS_DECISION since the clarification file added no extra constraint beyond "reachable and usable at mobile width."
- Chose `@testing-library/user-event` over raw `fireEvent.keyDown` for the keyboard tests because `fireEvent.keyDown` on a `<button>` does not synthesize the browser's native "Enter/Space activates the button" behavior in jsdom; `user-event` does, so the test exercises what a real keyboard user would experience rather than a synthetic keydown that the component's own code never explicitly handles.
- Mocked `next/navigation`'s `useRouter` in the new test file (same pattern as `tests/unit/app-sidebar-trash-nav.test.tsx`) since `WeekView` renders `PeopleSwitcherUrlBound`, which calls `useRouter()` — required to mount `WeekView` outside a real Next.js app router tree.

## Out-of-scope work needed
None identified. The stacked/day-strip mobile view (F031-F039) is a separate milestone and out of scope here; this feature only concerns the week-view header row.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Collapsed the PeopleSwitcher trigger's text label to `hidden sm:inline` (icon + `aria-label` remain at all widths) to keep the header row from overflowing at mobile widths, since AS-061 requires the switcher be "reachable and usable" there and the clarification file added no more specific guidance than the spec's own draft scope.

## Notes for the next worker
No MCP usage — this is a pure UI/a11y feature with no live external service state to introspect. The pre-existing `npx vitest run tests/unit` failures (41 files, all Sitemap Builder `f0NN-*` specs plus two date-dependent due-date tests) were confirmed pre-existing by stashing this feature's changes and re-running against unmodified HEAD — identical failures, unrelated to calendar/people-switcher code.
