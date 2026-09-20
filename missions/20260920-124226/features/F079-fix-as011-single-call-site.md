# F079: Fix AS-011 — single buildPlannerNavHrefs call, no weekHrefFor closure

**Milestone:** M6 follow-up 4 (scrutiny pass 4 blocker — 4th attempt)
**Estimated worker time:** 25 minutes

## Root cause (read very carefully)

F075 extracted `buildPlannerNavHrefs` into `lib/calendar/week-nav.ts` and wired `page.tsx` to use it. But page.tsx STILL has its own `weekHrefFor` helper closure:

```ts
// page.tsx — current broken state
const weekHrefFor = (key: string) =>
  buildPlannerNavHrefs({ workspaceSlug, currentWeekKey: weekKey,
    prevWeekKey: key, nextWeekKey: key, peopleParam }).prevHref;
```

This means `peopleParam` appears in the source but can be changed to `undefined` at line ~93 in page.tsx without any test failing.

## Required structural fix

**Step 1 — page.tsx must make exactly ONE call to `buildPlannerNavHrefs`:**

```ts
// CORRECT
const { prevHref, nextHref, todayHref } = buildPlannerNavHrefs({
  workspaceSlug,
  currentWeekKey: weekKey,
  prevWeekKey: prevWeekKey,   // whatever the prev key is
  nextWeekKey: nextWeekKey,   // whatever the next key is
  todayWeekKey: todayWeekKey, // whatever today's key is
  peopleParam,
});
```

Delete the `weekHrefFor` closure entirely. Pass all three hrefs directly to `WeekGridSection`.

**Step 2 — Update `buildPlannerNavHrefs` signature** if needed to accept `prevWeekKey`, `nextWeekKey`, `todayWeekKey` as separate params (or however the existing function works).

**Step 3 — Update tests.**

The test calls `buildPlannerNavHrefs(...)` and asserts on the returned href strings. The mutation is: change `peopleParam` to `null` or `undefined` in the function body → the returned href must NOT contain `?people=`. This already works from F075.

**Step 4 — Source guard.**

Add a test that reads `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` and asserts:
- It contains exactly ONE occurrence of `buildPlannerNavHrefs(`
- It does NOT contain `weekHrefFor`

This prevents re-introduction of the closure.

## Mutation to verify

1. In `lib/calendar/week-nav.ts`, set `peopleParam = undefined` inside `buildPlannerNavHrefs` → 2+ tests fail
2. In `page.tsx`, change `peopleParam` to `undefined` in the `buildPlannerNavHrefs` call → source guard test fails (because it confirms peopleParam is passed; or the behavioral test on the real function already covers it)

## Gate

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx
# Mutation 1: peopleParam=undefined in week-nav.ts → FAIL
# Mutation 2: weekHrefFor closure re-added to page.tsx → source guard FAIL
```
