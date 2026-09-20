# F087: Fix AS-052 — replace source regex with data-flow test via extracted helper

**Milestone:** M6 follow-up 8 (scrutiny pass 8 FAIL)

## Problem

The AS-052 source regex at `tests/unit/f029-switcher-url-wiring.test.tsx` is defeatable in both directions:
1. A commented-out decoy line `// peopleSwitcherMembers={workspaceMembers.active.map(...)}` above a live `.pending` prop leaves 16/16 green — invited members leak into the switcher.
2. A plain refactor to `const switcherMembers = workspaceMembers.active.map(...)` (correct code) causes a false failure.
Also: the `activeMemberIds` call at `page.tsx:108` is unguarded.

## Fix

### Step 1 — Extract a pure helper

In `lib/calendar/workspace-members.ts` (new file), extract a pure function:

```ts
export function buildSwitcherMembers(
  workspaceMembers: { active: WorkspaceMember[]; pending?: WorkspaceMember[] }
): { switcherMembers: WorkspaceMember[]; activeMemberIds: string[] } {
  return {
    switcherMembers: workspaceMembers.active,
    activeMemberIds: workspaceMembers.active.map((m) => m.userId),
  };
}
```

Adjust the type to match actual types used in the project. Read `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` and the types it imports to get the correct types.

### Step 2 — Use the helper in page.tsx

In `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`, replace:
- the `peopleSwitcherMembers={workspaceMembers.active.map(...)}` JSX prop
- the `activeMemberIds: workspaceMembers.active.map(m => m.userId)` call

with a single call to `buildSwitcherMembers(workspaceMembers)` before the return, then use `switcherMembers` and `activeMemberIds` from its result.

### Step 3 — Replace the source regex test with a unit test

In `tests/unit/f029-switcher-url-wiring.test.tsx`, delete the AS-052 source regex block. Replace it with a unit test of `buildSwitcherMembers`:

```ts
import { buildSwitcherMembers } from "@/lib/calendar/workspace-members";

it("test_AS_052_only_active_members_reach_switcher_and_allowlist", () => {
  const active = [
    { userId: "u1", name: "Alice", status: "active" },
    { userId: "u2", name: "Bob", status: "active" },
  ];
  const pending = [
    { userId: "u3", name: "Carol (pending)", status: "pending" },
  ];

  const result = buildSwitcherMembers({ active, pending });

  // switcherMembers must be exactly the active list
  expect(result.switcherMembers).toHaveLength(2);
  expect(result.switcherMembers.map(m => m.userId)).toEqual(["u1", "u2"]);
  // pending member must not appear
  expect(result.switcherMembers.some(m => m.userId === "u3")).toBe(false);

  // activeMemberIds feeds parsePeopleParam's allowlist
  expect(result.activeMemberIds).toEqual(["u1", "u2"]);
  expect(result.activeMemberIds).not.toContain("u3");
});
```

Mutation to verify: change `workspaceMembers.active` to `[...workspaceMembers.active, ...(workspaceMembers.pending ?? [])]` inside `buildSwitcherMembers` → the test MUST FAIL (carol appears).

### Step 4 — Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx
# Mutation: include pending in buildSwitcherMembers → MUST FAIL
# Restore
```

All must pass. Commit before exiting.

### Handoff

Write `missions/20260920-124226/handoffs/F087-handoff.md` with Status: COMPLETE (or BLOCKED). Include the mutation result.
