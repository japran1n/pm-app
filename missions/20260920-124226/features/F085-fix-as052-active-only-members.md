# F085: Fix AS-052 — test only active members appear (not pending)

**Milestone:** M6 follow-up 7 (scrutiny pass 7 major)

## Problem

No test asserts that only `workspaceMembers.active` members appear in the switcher. Swapping to `[...active, ...pending]` at the page call sites breaks no test.

Note: `PeopleSwitcher` receives a `members` prop from the caller — this is about what the PAGE passes, and also about what the component renders when given a mixed list.

## Fix

In `tests/unit/people-switcher.test.tsx`, add a test:

1. Render `PeopleSwitcher` with a members list that includes 2 active members only (no pending/inactive members)
2. Open the popover
3. Assert exactly those 2 members are visible in the list (no extra rows)

AND add a source-level check in `tests/unit/f029-switcher-url-wiring.test.tsx` (or a new file):
- Read `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`
- Assert that the string passed as `members=` to `PeopleSwitcher` (or `PeopleSwitcherUrlBound`) references `workspaceMembers.active`, NOT `workspaceMembers.all` or a spread of both active+pending

The source check mutation: change `workspaceMembers.active` to `workspaceMembers.pending` → source check MUST FAIL.

## Gate

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/people-switcher.test.tsx
# Mutation: active → pending in page.tsx → source scan MUST FAIL
# Restore
```
