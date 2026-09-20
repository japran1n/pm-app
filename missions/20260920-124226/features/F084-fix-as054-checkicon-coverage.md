# F084: Fix AS-054 — test CheckIcon presence for selected vs unselected items

**Milestone:** M6 follow-up 7 (scrutiny pass 7 blocker)

## Problem

F081 added a `CheckIcon` to selected `CommandItem` elements, but no test asserts its presence. Deleting both the `<CheckIcon/>` and the `bg-accent` className leaves all 22 tests green — the visual fix can be silently reverted.

## Fix

In `tests/unit/people-switcher-multiselect.test.tsx`, add a test that:

1. Renders `PeopleSwitcher` with one member pre-selected (e.g. `selectedUserIds={["member-a"]}`)
2. Opens the popover
3. Asserts that member-a's `CommandItem` contains a checkmark indicator:
   - Either: the item has `data-checked="true"` AND contains an SVG (the CheckIcon)
   - Or: the item has class `bg-accent` or similar selected class
   - The test must be specific enough that deleting the CheckIcon OR the selected class causes it to fail

4. Also asserts that an unselected member's item does NOT have the checkmark/selected class.

Implementation approach: after opening the popover, find the CommandItem for member-a (by its text content or role), then:
```ts
const aliceItem = screen.getByRole("option", { name: /alice/i });
// CheckIcon is an SVG inside the item
expect(aliceItem.querySelector("svg")).toBeInTheDocument();
// OR check data-checked
expect(aliceItem).toHaveAttribute("data-checked", "true");
```

For the unselected member (bob):
```ts
const bobItem = screen.getByRole("option", { name: /bob/i });
expect(bobItem.querySelector("svg")).not.toBeInTheDocument();
// OR
expect(bobItem).not.toHaveAttribute("data-checked");
```

Mutation to verify: delete `{isSelected && <CheckIcon className="ml-auto h-4 w-4" />}` from people-switcher.tsx → test MUST FAIL.

## Gate

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/people-switcher-multiselect.test.tsx
# Mutation: delete CheckIcon line → MUST FAIL
# Restore
```
