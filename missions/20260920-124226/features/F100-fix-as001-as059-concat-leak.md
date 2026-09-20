# F100: Fix AS-001/AS-059 — remove activeMemberIds concat in page.tsx

**Milestone:** M7 follow-up (scrutiny pass 3 FAIL)

## Problem

`app/(workspace)/w/[workspaceSlug]/calendar/page.tsx:139` currently does:
```ts
const blockUserIds = buildBlockUserIds(selectedUserIds).concat(activeMemberIds);
```

This means ALL active members' blocks are always fetched, leaking the entire team's data on every load. `buildBlockUserIds` is an identity function; `concat(activeMemberIds)` adds everyone else back in. AS-001 and AS-059 are still failing.

## Fix

### Step 1 — Remove the concat

In `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`, change:
```ts
const blockUserIds = buildBlockUserIds(selectedUserIds).concat(activeMemberIds);
```
to:
```ts
const blockUserIds = buildBlockUserIds(selectedUserIds);
```

`buildBlockUserIds(selectedUserIds)` already returns `[...selectedUserIds]` — the selection is exactly what should be passed to `getCalendarBlocks`.

### Step 2 — Add an integration-style page test

The scrutiny recommended a single test that renders `CalendarPage` with stubbed queries and asserts on call arguments. In `tests/unit/f031-page-layout-derivation.test.tsx`, add:

```ts
it("test_AS_059_block_fetch_uses_only_selected_user_ids_not_all_members", async () => {
  // Mock getCalendarBlocks to capture its arguments
  const mockGetCalendarBlocks = vi.fn().mockResolvedValue([]);
  vi.mock("@/lib/queries/calendar-blocks", () => ({
    getCalendarBlocks: mockGetCalendarBlocks,
  }));

  // Simulate page with ?people=alice-id (only alice selected, not the whole team)
  const allActiveIds = ["alice-id", "bob-id", "carol-id"];
  const selectedIds = ["alice-id"];
  
  // Call the page's data-fetching logic directly (or import the helper)
  // The blockUserIds must equal selectedIds, NOT allActiveIds
  const blockUserIds = buildBlockUserIds(selectedIds);
  expect(blockUserIds).toEqual(["alice-id"]);
  expect(blockUserIds).not.toContain("bob-id");
  expect(blockUserIds).not.toContain("carol-id");
  
  // Mutation: concat activeMemberIds → MUST FAIL (result length > 1)
});
```

Adjust the approach to what's actually testable given the page structure. The key invariant: `blockUserIds` must equal `selectedUserIds` exactly — no extra members appended.

### Step 3 — Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f031-page-layout-derivation.test.tsx
npx next build
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F100-handoff.md`.
