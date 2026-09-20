# F075: Fix AS-011 — refactor page.tsx href building so tests observe real call sites

**Milestone:** M6 follow-up 3 (scrutiny pass 3 blocker — 3rd attempt)
**Estimated worker time:** 25 minutes

## Root cause (read carefully)

Every prior fix (F067, F071) wrote tests that mirror or re-implement the production logic in the test file itself. Nothing tests `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` directly. When `peopleParam: undefined` is passed at page.tsx:93–94, the test still passes because the test has its own copy of the logic.

## Required approach

**Step 1 — Extract the href builder from page.tsx.**

`page.tsx` currently computes `weekHrefFor`, `prevHref`, `nextHref`, `todayHref` inline. Move this into a named export:

```ts
// lib/calendar/week-nav.ts (or add to lib/calendar/people-selection.ts)
export function buildPlannerNavHrefs(params: {
  workspaceSlug: string;
  currentWeekKey: string;
  prevWeekKey: string;
  nextWeekKey: string;
  peopleParam: string | null;
}): { prevHref: string; nextHref: string; todayHref: string }
```

This function must call `buildWeekNavHref` (or inline the same logic). The point is: this is the function `page.tsx` calls.

**Step 2 — Use this function in page.tsx.**

Replace the inline href construction in page.tsx with a call to `buildPlannerNavHrefs`. The call must pass `peopleParam` (from `searchParams.people`).

**Step 3 — Test `buildPlannerNavHrefs` directly.**

In `tests/unit/f029-switcher-url-wiring.test.tsx`:
- Call `buildPlannerNavHrefs({ workspaceSlug: "acme", currentWeekKey: "2026-09-14", prevWeekKey: "2026-09-07", nextWeekKey: "2026-09-21", peopleParam: "alice,bob" })`
- Assert `prevHref` contains `people=alice%2Cbob` (or `people=alice,bob`)
- Assert `nextHref` contains `people=alice%2Cbob`
- Assert `todayHref` does NOT contain `people=` (today always uses current selection, not a fixed param)
  OR assert `todayHref` also contains the param — whichever matches the implementation. The key is it must be derived from `peopleParam`, not ignored.

**Step 4 — Source guard for page.tsx.**

Add a test that reads the source of `page.tsx` and asserts it imports and calls `buildPlannerNavHrefs` (not the old inline helper). This is a safeguard only — the behavioral test in Step 3 is the primary guard.

## Mutation

After implementation, verify:
- Set `peopleParam: undefined` inside `buildPlannerNavHrefs` → Step 3 tests fail (prevHref/nextHref lose `?people=`)
- Set `peopleParam: null` inside `page.tsx`'s call to `buildPlannerNavHrefs` → Step 3 tests are not affected (they don't call page.tsx), BUT the Step 4 source guard will catch a refactor that drops the param

## Files
- `lib/calendar/week-nav.ts` (create or modify)
- `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` (use the new function)
- `tests/unit/f029-switcher-url-wiring.test.tsx`

## Gate
```bash
npx tsc --noEmit           # must be clean
npx eslint . --max-warnings=0  # must be clean
npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx
# Mutation: peopleParam=undefined inside buildPlannerNavHrefs → MUST FAIL
```
