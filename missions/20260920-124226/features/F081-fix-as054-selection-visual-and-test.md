# F081: Fix AS-054 — add visible selected state + real click test

**Milestone:** M6 follow-up 6 (scrutiny pass 6 blocker)
**Estimated worker time:** 25 minutes

## Problem

Two issues:
1. `people-switcher.tsx` sets `data-checked`/`aria-selected` on `CommandItem` but `components/ui/command.tsx` styles neither. Selecting members produces no visible on-screen change.
2. `test_AS_054_three_members_can_be_selected_simultaneously` renders a pre-set `selectedUserIds` prop without clicking anything — it cannot detect a broken toggle.

## Fix

**Part 1 — Visual selected state.**

In `components/ui/command.tsx` (or via Tailwind classes on `CommandItem` in `people-switcher.tsx`), add a visible indicator when a member is selected. The simplest approach:

```tsx
// In people-switcher.tsx CommandItem:
<CommandItem
  key={member.userId}
  value={member.userId}
  onSelect={() => toggleMember(member.userId)}
  data-checked={isSelected ? "true" : undefined}
  aria-selected={isSelected}
  className={cn(
    "flex items-center gap-2 cursor-pointer",
    isSelected && "bg-accent font-medium"  // visible selected state
  )}
>
  {/* existing avatar + name */}
  {isSelected && <CheckIcon className="ml-auto h-4 w-4" />}
</CommandItem>
```

OR add a checkmark SVG/icon. The key requirement: when selected, the item must have a visually distinguishable state (background change, checkmark, or both).

**Part 2 — Real click test.**

In `tests/unit/people-switcher-multiselect.test.tsx`:
- Start with `selectedUserIds=[]`
- Render `PeopleSwitcher` with 3 members and `onSelectionChange` mock
- Open the popover
- Click member A → assert `onSelectionChange` called with `["member-a"]`
- Click member B → assert called with `["member-a", "member-b"]`
- Click member C → assert called with `["member-a", "member-b", "member-c"]`
- Check all 3 are simultaneously selected

Also assert the selected items show a checkmark or `data-checked="true"` attribute.

Mutation: change `toggleMember` to always replace the entire selection (not toggle) → the "3 simultaneously selected" test must fail.

## Gate

```bash
npx vitest run tests/unit/people-switcher-multiselect.test.tsx
# Mutation: break multi-select toggle → MUST FAIL
```
