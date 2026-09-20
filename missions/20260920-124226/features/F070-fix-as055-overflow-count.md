# F070: Fix AS-055 — test overflow count with default maxVisibleAvatars

**Milestone:** M6 follow-up (scrutiny pass 1 major)
**Estimated worker time:** 15 minutes

## Problem

AS-055 overflow count test:
1. Always passes an explicit `maxVisibleAvatars` value — the production default (3) is never exercised.
2. Mutating `maxVisibleAvatars` default from 3 to 99 makes no test fail.
3. The overflow expression can change from `selectedMembers.length` to `selectedUserIds.length` undetected.

## Fix

In `tests/unit/people-switcher-multiselect.test.tsx`:

1. Add a test that selects 5 members WITHOUT passing `maxVisibleAvatars` explicitly (use the component default). Assert the trigger shows exactly 3 avatars + a "+2" overflow badge.
2. Add a test that asserts the overflow count is `selectedCount - maxVisibleAvatars` (not just any positive number), using a 4-member selection with default max=3 → overflow should be exactly "+1".
3. Mutation to verify: change the default `maxVisibleAvatars` from 3 to 5 in `people-switcher.tsx` → the "no explicit max" test must fail (shows 5 avatars with no overflow).

## Files
- `tests/unit/people-switcher-multiselect.test.tsx`
- `components/calendar/people-switcher.tsx` (mutation target only)

## Gate

```bash
npx vitest run tests/unit/people-switcher-multiselect.test.tsx
# Mutation: change default maxVisibleAvatars from 3 to 5 → test MUST FAIL
# Restore
```

## Definition of done
- Default `maxVisibleAvatars=3` is exercised without explicit prop
- Overflow count is exact (not just truthy)
- Mutation (change default) causes failure
- All tests pass with real code
- Committed
