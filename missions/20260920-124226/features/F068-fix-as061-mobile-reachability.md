# F068: Fix AS-061 — rewrite vacuous mobile-reachability test

**Milestone:** M6 follow-up (scrutiny pass 1 blocker)
**Estimated worker time:** 20 minutes

## Problem

The current AS-061 test in `tests/unit/people-switcher-placement-a11y.test.tsx` is vacuous:
1. It asserts `not.toMatch(/(^|\s)hidden(\s|$)/)` — no Tailwind responsive variant (`sm:hidden`) matches this pattern.
2. Its header-row lookup `switcherTrigger.closest('[class*="flex"]')` resolves to the trigger itself.
3. `window.innerWidth = 375` changes nothing in jsdom CSS.

Mutation: add `sm:hidden` to the trigger → all tests pass, but the switcher would disappear at ≥sm in production.

## Fix

Replace the vacuous mobile test with a behavioural assertion:

The trigger button in `people-switcher.tsx` uses `hidden sm:inline` for its text label (responsive hide). The trigger BUTTON itself must NOT be hidden at any width. Assert:
1. The trigger element does not have a class that would unconditionally hide it (i.e. bare `hidden` not inside a responsive variant, `display:none`, `visibility:hidden`).
2. The trigger is the same element at simulated 375px and 1280px width (it doesn't change to a different element).
3. The aria-label remains present at 375px so screen readers can identify it.

Additionally assert that within the header section containing both week-nav and the switcher, the switcher is a sibling/descendant (co-located), by checking that the switcher trigger shares a common ancestor with the prev/next buttons at a depth ≤ 4 levels.

## Files
- `tests/unit/people-switcher-placement-a11y.test.tsx`

## Gate

```bash
npx vitest run tests/unit/people-switcher-placement-a11y.test.tsx
# Mutation: add class="hidden" to the trigger button in people-switcher.tsx → AS-061 test MUST FAIL
# Restore mutation
```

## Definition of done
- Mutation (adding bare `hidden` class to trigger) causes the test to fail
- All placement/a11y tests pass
- Committed
