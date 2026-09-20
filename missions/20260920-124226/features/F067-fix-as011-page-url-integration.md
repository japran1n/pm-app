# F067: Fix AS-011 — test that page.tsx actually passes ?people= to nav hrefs

**Milestone:** M6 follow-up (scrutiny pass 1 blocker)
**Estimated worker time:** 20 minutes

## Problem

AS-011 is currently tested only against `buildWeekNavHref` in isolation. The actual call sites in `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` (lines ~92-94) can silently drop `?people=` from the prev/next/today hrefs without any test failing.

Mutation: delete `peopleParam` from both `buildWeekNavHref` calls in `page.tsx` → all M6 tests stay green.

## Fix

Add a test that imports the calendar `page.tsx` module (or reads it as source) and asserts:

1. Both `buildWeekNavHref` call sites in `page.tsx` pass the `people` param (source-level check similar to the F060 import-allowlist pattern — read the file, grep for `buildWeekNavHref(`, assert the `people:` kwarg is present in each call).
2. OR: render the page with a `?people=alice,bob` param and assert the rendered prev/next hrefs contain `people=alice%2Cbob` (or `people=alice,bob`).

Option 1 (source-level) is simpler to implement without a full Next.js server render harness. Option 2 is more robust. Choose whichever is achievable without new dependencies.

## Files
- `tests/unit/f029-switcher-url-wiring.test.tsx` — add cases here, or create a new file

## Gate

```bash
npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx
# Mutation: remove peopleParam from buildWeekNavHref calls in page.tsx → test MUST FAIL
# Restore mutation
```

## Definition of done
- Mutation (delete `people:` arg from page.tsx `buildWeekNavHref` calls) causes at least one test to fail
- All tests pass with the real code
- `npx tsc --noEmit` clean
- Committed
