# F086: Fix AS-060 — real keyboard navigation test for people switcher

**Milestone:** M6 follow-up 7 (scrutiny pass 7 major)

## Problem

The existing keyboard navigation test in `tests/unit/people-switcher-placement-a11y.test.tsx` has AS-060 as "PASS" but the scrutiny found that deleting the `{ArrowDown}` step yields an identical result — cmdk auto-highlights the sole filtered row, so arrow navigation has zero real coverage.

## Fix

Rewrite or supplement the AS-060 test so that:

1. The popover has at least 3 members (not 1)
2. With no filter active, the first item has focus by default (or no focus — verify current behavior)
3. Press ArrowDown TWICE → the 3rd item should be focused/highlighted (or index 2, 0-based)
4. Assert the 3rd item is highlighted (has `data-highlighted` or `data-selected` from cmdk's keyboard state, or use `aria-activedescendant` on the listbox)
5. Press ArrowDown once more → focus wraps to first OR reaches 4th item if there is one

The test must fail if ArrowDown is swapped for ArrowUp (items would go in reverse order).

Alternate approach that's more robust: use `userEvent` library (already in the test stack as `@testing-library/user-event`):
```ts
await user.keyboard("{ArrowDown}{ArrowDown}");
// Assert item 3 (index 2) is focused
```

Then assert via `screen.getByRole("option", { name: /carol/i })` having `data-highlighted` or similar cmdk attribute, or via the container's `aria-activedescendant`.

Mutation: replace the 2 ArrowDown presses with 0 → focus stays on item 1 → assert on item 3 MUST FAIL.

## Gate

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/people-switcher-placement-a11y.test.tsx
```
