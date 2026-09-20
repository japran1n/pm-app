# F110: Fix AS-068 — scroll and min-height rendered assertion

**Milestone:** M7 follow-up (scrutiny pass 7 FAIL)

## Problem

AS-068 asserts: stacked layout has overflow-y scroll container and each row has min-height so short days don't compress rows. Both halves are undefended:
- `overflow-hidden` instead of `overflow-y-auto` passes 8/8
- `min-h-[6rem] shrink-0` → `min-h-0 shrink` (exactly the compression forbidden) passes 15/15

## Fix

### Step 1 — Find the scroll container

Read `components/calendar/stacked-planner.tsx`. Find the outer scroll container (`overflow-y-auto max-h-[calc(100vh-200px)]` or similar). Find the per-row element with `min-h-[6rem]`.

### Step 2 — Add rendered CSS class assertion

In `tests/unit/f036-stacked-scroll-colour.test.tsx` or a new test file:

```ts
it("test_AS_068_scroll_container_and_row_min_height", () => {
  render(
    <StackedPlanner
      selectedUserIds={["alice", "bob"]}
      members={[...]}
      blocksByUser={new Map()}
      weekKey="2026-W38"
      workspaceSlug="test"
      selfId="alice"
      weekParam="2026-W38"
    />
  );
  
  // Scroll container must have overflow-y-auto
  const scrollContainer = screen.getByTestId("stacked-scroll-container"); 
  // or use container.querySelector or className check
  expect(scrollContainer.className).toMatch(/overflow-y-auto/);
  
  // Each row must have min-h class
  const rows = screen.getAllByTestId(/stacked-row-/);
  for (const row of rows) {
    expect(row.className).toMatch(/min-h-\[6rem\]/);
    expect(row.className).not.toMatch(/shrink(?!-0)/); // no bare "shrink"
    expect(row.className).toMatch(/shrink-0/);
  }
});
```

Read the actual component to find correct testids and class names.

Mutation: change `overflow-y-auto` to `overflow-hidden` → MUST FAIL. Change `min-h-[6rem]` to `min-h-0` → MUST FAIL.

### Step 3 — Add testid if missing

If `stacked-scroll-container` testid is missing, add `data-testid="stacked-scroll-container"` to the scroll div in stacked-planner.tsx.

### Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run (targeted test file)
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F110-handoff.md`.
