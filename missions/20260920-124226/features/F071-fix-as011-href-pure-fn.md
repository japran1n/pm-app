# F071: Fix AS-011 — extract href derivation to pure function, test it

**Milestone:** M6 follow-up 2 (scrutiny pass 2 blocker)

## Problem

The F067 source-regex guard is gameable: `buildWeekNavHref({ ..., peopleParam: undefined })` keeps the token, silently drops `?people=`, and all tests pass.

## Fix

Extract a testable pure helper (if not already) that builds prev/next/today hrefs WITH people param, and test it end-to-end:

```ts
// in lib/calendar/week-nav.ts or similar
export function buildWeekNavHref({workspaceSlug, weekKey, peopleParam}: {...}): string
```

Test: call it with `weekKey="2026-09-14"` and `peopleParam=["alice","bob"]` → assert the returned string contains `people=alice%2Cbob` (or unencoded `people=alice,bob`). Also test with `peopleParam=[]` → falls back to `?people=` being absent or contains `people=alice` (self). The test must fail when `peopleParam` arg is ignored (i.e. set it to `undefined` inside the function).

If `buildWeekNavHref` already exists in `lib/calendar/people-selection.ts` or similar, just add the test cases. The key is: the TEST receives a real href string and asserts the `?people=` query param value — not source text.

Also delete the F067 source-regex test that is now superseded.

## Gate

```bash
npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx  # or wherever the test lives
# Mutation: inside buildWeekNavHref, set peopleParam=undefined → test MUST FAIL
```
