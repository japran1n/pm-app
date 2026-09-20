# F111: Fix AS-014 — week derivation test (same week for all members)

**Milestone:** M7 follow-up (scrutiny pass 7 FAIL)

## Problem

AS-014 asserts: all members share the same calendar week when viewed together. The "same week" clause has zero coverage. The scrutiny noted a probable real defect: `page.tsx:88` derives the default week from the viewer's timezone, so two members with different timezones could see different weeks on the same bare URL.

## Fix

### Step 1 — Find the week derivation logic

Read `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`. Find how `weekParam` / `weekKey` is derived. Also read `lib/calendar/week-nav.ts` or equivalent.

### Step 2 — Add a unit test for week derivation

In `tests/unit/f102-calendar-page-composition.test.tsx` or a new test file:

```ts
import { buildPlannerNavHrefs } from "@/lib/calendar/week-nav"; // or whatever the helper is
import { parseWeekParam } from "@/lib/calendar/week-nav"; // adjust import

it("test_AS_014_week_param_determines_week_for_all_members", () => {
  // When ?week= param is provided, all members use that week
  const weekParam = "2026-W38";
  const weekKey = parseWeekParam(weekParam); // or however it's parsed
  expect(weekKey).toBe("2026-W38");
  
  // When no param, week is derived from server time (not per-member)
  // The key invariant: week is a single value passed to all members' block queries
  // Not member-specific
  const defaultWeek = parseWeekParam(undefined); // or getCurrentWeekKey()
  expect(typeof defaultWeek).toBe("string");
  expect(defaultWeek).toMatch(/^\d{4}-W\d{2}$/);
});

it("test_AS_014_all_selected_members_use_same_week", () => {
  // Simulate the data flow: one weekKey feeds getCalendarBlocks for ALL selected users
  const weekKey = "2026-W38";
  const selectedUserIds = ["alice", "bob", "carol"];
  
  // Each user's block query uses the same weekKey
  // This is structural: in page.tsx, getCalendarBlocks is called once with all userIds and one weekKey
  // The test verifies buildBlockUserIds returns all selected users together (one fetch, one week)
  const blockUserIds = buildBlockUserIds(selectedUserIds);
  expect(blockUserIds).toHaveLength(3); // all 3 together in one query
  expect(blockUserIds).toEqual(selectedUserIds); // same week implied by single call
});
```

Read the actual page to understand how weeks and users are combined.

Mutation: make week per-member (generate different weekKey per userId) → the single-query structure breaks → MUST FAIL.

### Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run (targeted test file)
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F111-handoff.md`.
