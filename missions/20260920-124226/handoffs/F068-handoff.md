# Handoff: F068 — Fix AS-061 — rewrite vacuous mobile-reachability test

## Status
COMPLETE

## Assertions covered
AS-061: PASS — rewritten test suite (`test_AS_061_switcher_trigger_is_never_unconditionally_hidden`, `test_AS_061_switcher_remains_operable_via_keyboard_and_search_regardless_of_viewport`) passes against current code; verified the first test FAILS when the trigger's className is mutated to `"hidden"` (temporary edit, reverted via `git checkout`).

## Files changed
tests/unit/people-switcher-placement-a11y.test.tsx

## Commands run
`npx vitest run tests/unit/people-switcher-placement-a11y.test.tsx` (0) — 6/6 tests pass on clean code
`npx vitest run tests/unit/people-switcher-placement-a11y.test.tsx` (1) — mutation run: trigger className forcibly overridden to `"hidden"` via a spread prop placed after the `cn(...)` className attribute (last JSX attribute wins); `test_AS_061_switcher_trigger_is_never_unconditionally_hidden` failed as required (`expected true to be false`), all other tests unaffected
`git checkout -- components/calendar/people-switcher.tsx` (0) — reverted the mutation; `git status --short` confirmed only the test file is modified before commit
`git commit` (0)

## Decisions made
- Kept the original vacuous checks' intent (no unconditional `hidden`, header-row co-location) but replaced the mechanism per spec: (1) `classTokens.includes("hidden")` catches a bare `hidden` token (not any token containing "hidden" as a substring, so `outline-hidden` and `hidden sm:inline` on the inner label span are unaffected) — this is deliberately narrower than the old broken regex path and is what a `class="hidden"` mutation on the trigger actually adds; (2) added `getComputedStyle` `display`/`visibility` checks as defense-in-depth even though jsdom doesn't resolve Tailwind CSS, since they're free additional coverage against inline-style mutations; (3) replaced `switcherTrigger.closest('[class*="flex"]')` (which resolved to the trigger itself, per the spec's bug report) with an explicit `findCommonAncestor` walk from the trigger up to a `contains()` match on the prev/next nav links, asserting depth ≤ 4 as the spec's "Fix" section specifies; (4) same-element identity check across simulated 375px and 1280px `window.innerWidth` writes, with `aria-label` presence re-checked at 375px, per spec item 2 and 3.
- Confirmed via manual mutation testing that a literal `sm:hidden` (responsive variant) on the trigger is NOT caught by the bare-token check (by design — a responsive hide really would need to disappear at some breakpoint and jsdom can't detect that without a real CSS engine); the spec's required gate is specifically the bare `hidden` (unconditional) mutation, which this test does catch. This narrower guarantee matches what's actually testable in jsdom without a CSS resolution layer, and matches the spec's own framing ("bare `hidden` not inside a responsive variant").
- Did not touch `components/calendar/people-switcher.tsx` itself — spec's "Files" section lists only the test file, and the current trigger implementation was already correct (no bare `hidden` class present).

## Out-of-scope work needed
None identified. If a future worker wants true responsive-breakpoint verification (e.g. actually detecting `sm:hidden` behaviour), that would require a real browser/CSS engine (Playwright) rather than jsdom — out of scope for this unit test fix per the spec's stated gate.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a bare-token match (`classTokens.includes("hidden")`) rather than trying to also flag responsive `hidden` variants, because jsdom cannot resolve CSS media queries/breakpoints, so any check claiming to catch `sm:hidden`-style hiding would itself be vacuous (exactly the bug this feature is fixing). The spec's mutation gate targets bare `class="hidden"` specifically, which this test reliably catches.

## Notes for the next worker
- To reproduce the mutation-failure verification: in `components/calendar/people-switcher.tsx`, add `{...{ className: "hidden" }}` as a JSX attribute immediately after the existing `className={cn(...)}` attribute on the `PopoverTrigger` (data-slot="people-switcher-trigger") — the later attribute wins in JSX/Babel, overriding the cn() output with a bare `"hidden"` string. Simply prepending `"hidden"` inside the `cn(...)` call does NOT reproduce the bug, because `cn()` uses `tailwind-merge`, which dedupes conflicting display-utility classes in the same string and drops `hidden` in favor of `flex` (both being `display` utilities) — so that particular mutation shape is silently absorbed and won't fail this test. This is worth knowing if a scrutiny validator tries to reproduce the gate differently.
- No MCP tools were used — this is a pure local unit-test fix with no external service or live-state involvement.
