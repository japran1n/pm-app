# F102: CalendarPage composition test — real data-flow assertions

**Milestone:** M7 follow-up (scrutiny pass 4 FAIL)

## Problem

All AS-001, AS-002, AS-014, AS-015, AS-023, AS-062, AS-063 guards are currently source-text regexes that survive one-line mutations. No test ever renders CalendarPage or exercises the actual props flow.

## Fix

Write a real server-component test in `tests/unit/f102-calendar-page-composition.test.tsx` that:

1. Mocks `getCalendarBlocks` to capture its arguments
2. Mocks `getWorkspaceMembers` to return a fixture with active + pending members
3. Calls the page's logic (or the page server function itself, or the key helpers in sequence)
4. Asserts that:
   - `getCalendarBlocks` is called with `userIds = selectedUserIds` (not selectedUserIds + allActive)
   - When `?people=` is absent, selectedUserIds = [selfId] (AS-001)
   - `resolvePlannerLayout(1)` = "week-grid" (AS-002/AS-014)
   - `resolvePlannerLayout(2)` = "stacked" (AS-014)
   - `buildSwitcherMembers` excludes pending members (AS-062 / active-only)
   - Row order in stacked = order of `?people=` param (AS-063)

### Approach

Since Next.js server components are hard to render in vitest, test the **helpers** and **call sites** in sequence rather than rendering the page component. The key is to import and call the actual functions from the page with test data:

```ts
import { parsePeopleParam, serializePeopleParam } from "@/lib/calendar/people-param";
import { resolvePlannerLayout } from "@/lib/calendar/planner-layout";
import { buildSwitcherMembers, buildBlockUserIds } from "@/lib/calendar/workspace-members";

// Simulate page.tsx logic with ?people=carol-id&alice-id
const selfId = "self-id";
const allActiveIds = ["self-id", "alice-id", "carol-id", "bob-id"];
const pendingIds = ["pending-id"];

// Parse ?people= param
const selectedUserIds = parsePeopleParam("carol-id,alice-id", selfId, allActiveIds);
// AS-063: order must match param, not sorted
expect(selectedUserIds[0]).toBe("carol-id");
expect(selectedUserIds[1]).toBe("alice-id");

// AS-001/AS-059: blockUserIds must equal selectedUserIds exactly
const blockUserIds = buildBlockUserIds(selectedUserIds);
expect(blockUserIds).toEqual(selectedUserIds);
expect(blockUserIds).not.toContain("bob-id");
expect(blockUserIds).not.toContain("pending-id");

// AS-014/AS-002: layout derivation
expect(resolvePlannerLayout(1)).toBe("week-grid");
expect(resolvePlannerLayout(2)).toBe("stacked");

// AS-062: switcher excludes pending
const { switcherMembers } = buildSwitcherMembers({ 
  active: allActiveIds.map(id => ({ userId: id, name: id, status: "active" })),
  pending: [{ userId: "pending-id", name: "Pending", status: "pending" }]
});
expect(switcherMembers.map(m => m.userId)).not.toContain("pending-id");
```

### Mutation requirements

Each assertion must be independently mutated to verify it fails:
- Change `buildBlockUserIds` to append `activeMemberIds` → `expect(blockUserIds).toEqual(selectedUserIds)` MUST FAIL
- Change `parsePeopleParam` to sort alphabetically → carol/alice order test MUST FAIL
- Change `resolvePlannerLayout(2)` to return "week-grid" → AS-014 MUST FAIL
- Include pending in `buildSwitcherMembers` → AS-062 MUST FAIL

Run each mutation, confirm failure, restore.

### Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f102-calendar-page-composition.test.tsx
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F102-handoff.md`.
Document each mutation result in the handoff.
