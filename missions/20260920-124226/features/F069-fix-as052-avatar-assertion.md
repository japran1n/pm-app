# F069: Fix AS-052 — assert avatar presence per member row

**Milestone:** M6 follow-up (scrutiny pass 1 major)
**Estimated worker time:** 15 minutes

## Problem

AS-052 test counts `[data-slot="avatar"]` elements but never asserts their content/src. Mutation: replace each row's avatar body with a bare `<Avatar size="sm" />` (no image/initials) — test still passes.

## Fix

In `tests/unit/people-switcher.test.tsx` (or `people-switcher-multiselect.test.tsx`), for the combobox member list:

1. Assert that each member row contains an avatar element with either:
   - A rendered image whose `src` includes the member's avatarUrl (when avatarUrl is non-null), OR
   - Fallback initials text derived from the member's name (when avatarUrl is null)
2. Mutation: strip the `avatarUrl` prop from the Avatar render → the test must detect the absence of the expected src/initials.

Use a fixture with at least one member who has a non-null `avatarUrl` and one with a null `avatarUrl`, asserting both cases.

## Files
- `tests/unit/people-switcher.test.tsx` or `tests/unit/people-switcher-multiselect.test.tsx`

## Gate

```bash
npx vitest run tests/unit/people-switcher.test.tsx tests/unit/people-switcher-multiselect.test.tsx
# Mutation: remove avatarUrl rendering from PeopleSwitcher member row → test MUST FAIL
# Restore
```

## Definition of done
- Mutation (strip avatar content) causes at least one test to fail
- All tests pass with real code
- Committed
