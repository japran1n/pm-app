# F083: Fix AS-055 — overflow test with non-default maxVisibleAvatars

**Milestone:** M6 follow-up 6 (scrutiny pass 6 major)

## Problem

The "when it does not fit" overflow test uses hardcoded `maxVisibleAvatars=3` — the component's own default. `slice(0,n)` → `slice(-n)` and dropped-unknown-ids mutations both survive.

## Fix

Add a test that passes an EXPLICIT `maxVisibleAvatars=2` (non-default) with 4 selected members:

```ts
// 4 members selected, max 2 visible → 2 avatars + "+2" badge
render(<PeopleSwitcher
  members={[alice, bob, carol, dave]}
  selectedUserIds={["alice", "bob", "carol", "dave"]}
  maxVisibleAvatars={2}
  ...
/>);

// Trigger shows exactly 2 avatars
expect(screen.getAllByRole("img")).toHaveLength(2);  // or data-slot="avatar"

// Overflow badge shows "+2"
expect(screen.getByText("+2")).toBeInTheDocument();
```

Also assert the 2 VISIBLE avatars are the FIRST 2 in selection order (not the last 2), by checking their src/initials:
- alice should be visible (first)
- bob should be visible (second)
- carol and dave should NOT be visible (overflowed)

Mutation: `slice(0, maxVisibleAvatars)` → `slice(-maxVisibleAvatars)` → carol and dave would be visible instead of alice and bob → test MUST FAIL.

## Gate

```bash
npx vitest run tests/unit/people-switcher-multiselect.test.tsx
# Mutation: slice(-n) instead of slice(0,n) → first-2-visible test MUST FAIL
```
