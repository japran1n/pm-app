# F056: Fix AS-006 — settle ordering contract; remove .sort() from test

**Milestone:** M3 follow-up (M3-scrutiny-1 major)
**Estimated worker time:** 15 minutes
**Depends on:** F012

## Problem

`tests/unit/calendar-blocks-people-filter.test.ts` calls `.sort()` on result
ids in the multi-user test, making order invisible. `restrictedUserIds` is
also built from an unordered `workspace_members` result, discarding the
caller's `userIds` order.

## Decision (autonomous — per ZERO_QUESTIONS mode)

Block ordering is `starts_at ASC` only. Person-order within a single query
result has no meaning until F032 assigns each person their own row. AS-006
text says "shows exactly those members' blocks"; the "in order" gloss in the
milestone brief refers to the URL `?people=` order, which is about which
people are shown, not the intra-query sort of their blocks. Strike the phantom
requirement — person-order is F032's concern (AS-062/AS-063).

## Fix

1. Remove `.sort()` from the multi-user assertion in
   `calendar-blocks-people-filter.test.ts`.
2. Assert the correct invariant instead: **all and only** the blocks
   belonging to the requested users are present (set equality, order
   irrelevant at this layer). The `starts_at` ordering can be verified by
   asserting the result is sorted by `starts_at` ascending.
3. No implementation change to `getCalendarBlocks` — the `.order("starts_at")`
   is already there.

## Files

- `tests/unit/calendar-blocks-people-filter.test.ts` only

## Gate

```bash
npx vitest run tests/unit/calendar-blocks-people-filter.test.ts
npx tsc --noEmit
```
