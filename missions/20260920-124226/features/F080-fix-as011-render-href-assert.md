# F080: Fix AS-011 — render component, assert real href attributes contain ?people=

**Milestone:** M6 follow-up 5 (scrutiny pass 5 blocker — 5th and final attempt)
**Estimated worker time:** 25 minutes

## THIS IS THE LAST ATTEMPT — if this fails, AS-011 will be DEFERRED

## Root cause

The regex guard `/buildPlannerNavHrefs\(\{[\s\S]*?peopleParam[\s\S]*?\}\)/` happily matches `peopleParam: undefined` and has allowed this bug through 5 passes. No test ever reads a rendered `<a href>` attribute.

## Required fix — no regex, render an actual component

**Step 1 — Find `WeekGridSection` (or whatever component page.tsx renders with the hrefs).**

Read `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` to find what component receives `prevHref`, `nextHref`, `todayHref`. It might be `WeekView` via `WeekGridSection`, or passed directly. Trace the prop chain.

**Step 2 — Write a unit test that renders that component and asserts anchor hrefs.**

```ts
// tests/unit/f080-calendar-nav-hrefs.test.tsx
import { render, screen } from "@testing-library/react";

it("test_AS_011_prev_href_preserves_people_param", () => {
  render(
    <WeekView
      prevHref="/w/acme/calendar?week=2026-09-07&people=alice%2Cbob"
      nextHref="/w/acme/calendar?week=2026-09-21&people=alice%2Cbob"
      todayHref="/w/acme/calendar?week=2026-09-14&people=alice%2Cbob"
      // ... other required props with minimal stubs
    />
  );
  
  const prevLink = screen.getByRole("link", { name: /prev/i });
  expect(prevLink).toHaveAttribute("href", expect.stringContaining("people=alice"));
  
  const nextLink = screen.getByRole("link", { name: /next/i });
  expect(nextLink).toHaveAttribute("href", expect.stringContaining("people=alice"));
});

it("test_AS_011_page_passes_people_param_to_nav_hrefs", () => {
  // Source-level check: page.tsx calls buildPlannerNavHrefs with peopleParam
  // AND does NOT use weekHrefFor
  const src = readFileSync("app/(workspace)/w/[workspaceSlug]/calendar/page.tsx", "utf8");
  expect(src).not.toContain("weekHrefFor");
  // Assert peopleParam variable is passed to the nav href builder
  // by checking the actual spread: NOT "peopleParam: undefined" or "peopleParam: null"
  expect(src).not.toMatch(/buildPlannerNavHrefs\([^)]*peopleParam\s*:\s*(undefined|null)/);
});
```

**Step 3 — Delete the regex guard from f029-switcher-url-wiring.test.tsx** that uses `/buildPlannerNavHrefs\(\{[\s\S]*?peopleParam[\s\S]*?\}\)/`.

**Step 4 — Delete tests/unit/f079-calendar-page-single-call-site.test.ts** (it's superseded by the href-render test).

## Mutation to verify

In `lib/calendar/week-nav.ts`, set `peopleParam = undefined` inside `buildPlannerNavHrefs` → the href-render test MUST FAIL (prevLink href doesn't contain "people=").

In `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`, change `peopleParam` to `undefined` in the `buildPlannerNavHrefs` call → the source-level regex-NOT check MUST FAIL.

## Gate

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f080-calendar-nav-hrefs.test.tsx
# Mutation 1: peopleParam=undefined in week-nav.ts → FAIL
# Mutation 2: peopleParam: undefined in page.tsx call → FAIL
# Restore both
```
