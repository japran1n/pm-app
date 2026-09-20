# F072: Fix AS-061 — Playwright mobile reachability spec

**Milestone:** M6 follow-up 2 (scrutiny pass 2 blocker)

## Problem

The jsdom-based AS-061 test cannot detect responsive Tailwind CSS (`sm:hidden`, `max-sm:hidden`) because jsdom never loads or evaluates the stylesheet. Every variant-prefixed hidden class passes.

## Fix

Write a Playwright E2E spec that:
1. Navigates to the calendar page at 375px viewport width
2. Asserts the PeopleSwitcher trigger button is visible (not `display:none`, not `visibility:hidden`, not `opacity:0`)
3. Clicks the trigger — popover opens
4. Selects a member by typing their name and clicking
5. Presses Escape — popover closes

Test file: `tests/e2e/m6-people-switcher-mobile.spec.ts`

If Playwright is not available (no live server), fall back to: add a CSS-in-test approach — render the component with a real `<style>` block that applies `.hidden { display: none }` and `.sm\\:hidden { display: none }` and assert visibility. The test must fail if `sm:hidden` is added to the trigger.

For the jsdom path: the real fix is to assert `!className.split(/\s+/).some(t => /^(sm:|md:|lg:|xl:|max-sm:|max-md:)?hidden$/.test(t))` — this rejects ALL responsive hidden variants.

Replace the current AS-061 test in `tests/unit/people-switcher-placement-a11y.test.tsx` with this regex approach, and verify: adding `sm:hidden` to trigger className → test FAILS; adding `md:hidden` → test FAILS; bare `hidden` → test FAILS.

## Gate

```bash
npx vitest run tests/unit/people-switcher-placement-a11y.test.tsx
# Mutation: add "sm:hidden" to trigger button className in people-switcher.tsx → MUST FAIL
# Mutation: add "hidden" to trigger className → MUST FAIL
```
