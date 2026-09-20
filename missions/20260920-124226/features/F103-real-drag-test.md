# F103: Real drag test with unmocked DndContext — AS-064, AS-065

**Milestone:** M7 follow-up (scrutiny pass 4 FAIL)

## Problem

`tests/unit/f035-stacked-reorder.test.tsx` mocks `DndContext` away entirely. Deleting `{...listeners}`, `sensors={sensors}`, or `items={selectedUserIds}` all pass. AS-065 (`weekParam` preserved on reorder) has zero test coverage.

## Fix

Rewrite or supplement the drag test to use the **keyboard sensor** from dnd-kit — this allows driving drag gestures without a real browser:

```ts
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StackedPlanner from "@/components/calendar/stacked-planner";

// Do NOT mock @dnd-kit/core or @dnd-kit/sortable
// Use real DndContext with KeyboardSensor

it("test_AS_064_drag_reorders_rows", async () => {
  const mockRouterReplace = vi.fn();
  vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: mockRouterReplace }),
  }));

  const members = [
    { userId: "carol", name: "Carol", avatarUrl: null },
    { userId: "alice", name: "Alice", avatarUrl: null },
    { userId: "bob", name: "Bob", avatarUrl: null },
  ];
  
  render(
    <StackedPlanner
      selectedUserIds={["carol", "alice", "bob"]}
      members={members}
      blocksByUser={new Map()}
      weekKey="2026-W38"
      workspaceSlug="test"
      selfId="carol"
      weekParam="2026-W38"
    />
  );

  // Find carol's drag handle
  const carolHandle = screen.getByTestId("stacked-row-drag-handle-carol");
  
  // Use keyboard sensor: Space to pick up, ArrowDown to move down, Space to drop
  carolHandle.focus();
  fireEvent.keyDown(carolHandle, { key: " ", code: "Space" });
  fireEvent.keyDown(carolHandle, { key: "ArrowDown", code: "ArrowDown" });
  fireEvent.keyDown(carolHandle, { key: " ", code: "Space" });

  // After drag: carol moved from index 0 to index 1
  // router.replace should have been called with ?people=alice,carol,bob
  expect(mockRouterReplace).toHaveBeenCalled();
  const url = mockRouterReplace.mock.calls[0][0];
  const params = new URLSearchParams(url.split("?")[1] ?? url);
  const people = params.get("people");
  expect(people).toContain("alice");
  // carol comes after alice now
  expect(people!.indexOf("alice")).toBeLessThan(people!.indexOf("carol"));
});

it("test_AS_065_weekParam_preserved_on_reorder", async () => {
  // Same setup but with weekParam = "2026-W39"
  // After drag, the ?week=2026-W39 param must still be in the URL
  const mockRouterReplace = vi.fn();
  // ... render with weekParam="2026-W39"
  // ... perform drag
  // expect URL to contain week=2026-W39
  const url = mockRouterReplace.mock.calls[0][0];
  expect(url).toContain("week=2026-W39");
});
```

### Key constraint

Do NOT add `vi.mock("@dnd-kit/core", ...)` or `vi.mock("@dnd-kit/sortable", ...)`. The real dnd-kit keyboard sensor works in jsdom. If there are jsdom compatibility issues with the keyboard sensor, use `fireEvent` directly on the drag handle element.

### Mutation requirements

- Delete `{...listeners}` from the drag handle in stacked-planner.tsx → drag handle is no longer keyboard-operable → MUST FAIL
- Remove `sensors={sensors}` → DndContext falls back to no sensor → drag gesture does nothing → MUST FAIL  
- Remove `weekParam` from the router.replace URL construction → AS-065 MUST FAIL

### Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f035-stacked-reorder.test.tsx
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F103-handoff.md`.
Document each mutation result.
