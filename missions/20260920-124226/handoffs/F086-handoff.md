# Handoff: F086 — Fix AS-060 real keyboard navigation test for people switcher

## Status
COMPLETE

## Assertions covered
AS-060: PASS — new test `test_AS_060_arrow_down_twice_highlights_the_third_filtered_member` uses a 3-member fixture, confirms row 1 is highlighted by default, then asserts row 3 (Carol) is highlighted (`aria-selected="true"`, `data-selected="true"`, and matching `aria-activedescendant` on the search input) only after two `{ArrowDown}` presses. Verified by mutation: removing the two ArrowDown presses makes the test fail on the `aria-selected` assertion for Carol (previous existing test kept as-is, also still PASS).

## Files changed
tests/unit/people-switcher-placement-a11y.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/people-switcher-placement-a11y.test.tsx` (0) — 5 passed
Mutation check: manually blanked the `{ArrowDown}{ArrowDown}` keyboard call and re-ran vitest — new test failed on `expect(carolOption).toHaveAttribute("aria-selected", "true")` inside a `waitFor`, confirming the test is sensitive to the ArrowDown presses. Restored the file afterward and re-ran the suite to confirm 5/5 pass again.

## Decisions made
- Added a separate `KEYBOARD_NAV_MEMBERS` fixture (Alice/Bob/Carol) scoped to the new test rather than mutating the shared `MEMBERS` fixture used by the AS-051 layout tests, to avoid changing behavior/coverage of unrelated tests.
- Filtered the popover by a shared "Roster" suffix on all three member names (cmdk's `CommandItem` filters on its `value` prop, which `people-switcher.tsx` sets to the member's display name — not the email). This narrows the visible list to exactly the 3 target members and excludes the "Just me" / "Whole team" shortcut rows, so the 2 ArrowDown presses map deterministically to Alice → Bob → Carol with no other rows to traverse.
- Investigated `node_modules/cmdk` source directly to confirm which DOM attribute reflects cmdk's keyboard-highlight state on `CommandItem`. Found that `people-switcher.tsx`'s own `CommandItem` passes an `aria-selected={isSelected}` prop (meaning "checked", i.e. an app-level override) as part of `...props`, but cmdk's internal `Item` component (in `cmdk/dist/index.mjs`) spreads that prop first and then unconditionally re-sets `aria-selected: !!R` (R = whether this row is the currently-highlighted row) afterward in the same object literal — so cmdk's own value always wins over the app's, and the DOM `aria-selected` attribute genuinely reflects keyboard-highlight state, not the app's "checked" intent. Used this attribute, plus cmdk's `data-selected` and the search input's `aria-activedescendant`, as the assertion targets.
- Kept the original `test_AS_060_switcher_can_be_opened_searched_and_toggled_with_keyboard_alone` and `test_AS_060_switcher_trigger_is_a_natively_focusable_button_element` tests untouched — they cover open/search/toggle/focusability, which the new test doesn't duplicate.

## Out-of-scope work needed
None identified. Note (informational, not a defect to fix under this feature): `people-switcher.tsx`'s `CommandItem` for member rows sets `aria-selected={isSelected}` intending to convey "checked" state, but this is silently overridden by cmdk's own highlight-based `aria-selected`. This means screen readers relying on `aria-selected` for "checked" state on member rows will instead hear keyboard-highlight state — a possible a11y correctness gap unrelated to AS-060, worth a follow-up if the mission wants "checked" state exposed via ARIA (e.g. via `aria-checked` instead, since these are effectively multi-select toggle rows).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the "Roster" name-suffix filtering approach (rather than email-domain filtering, which I tried first and which failed because cmdk filters on the CommandItem `value` prop = display name, not email) after reading the cmdk source to confirm exactly what text the filter matches against.

## Notes for the next worker
- cmdk's `Command.Item` (`node_modules/cmdk/dist/index.mjs`) sets `role="option"`, `aria-selected`, and `data-selected` based on internal highlight state (`v.value===b.current`), and the search `Command.Input` exposes `aria-activedescendant` equal to the highlighted item's DOM `id`. Any future keyboard-nav test in this repo can rely on these three signals.
- No MCP tools used — this is a pure unit-test fix with no external service or live-state dependency.
