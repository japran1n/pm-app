# F101: Fix AS-064 — test must not mock away DndContext entirely

**Milestone:** M7 follow-up (scrutiny pass 3 FAIL)

## Problem

The AS-064 test in `tests/unit/f035-stacked-reorder.test.tsx` mocks `DndContext` away entirely. This means deleting `{...listeners}` from `stacked-planner.tsx:76` or removing `sensors={sensors}` passes 5/5 — the row becomes undraggable but tests still pass.

The test guards `aria-roledescription`/`tabIndex` which come from `{...attributes}`, not `{...listeners}`. Listeners are what actually make drag work.

## Fix

### Option A — Test the source, not the DOM

Replace or augment the existing test with a source-text check:

```ts
it("test_AS_064_drag_listeners_wired_to_handle", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "components/calendar/stacked-planner.tsx"),
    "utf-8"
  );
  // {listeners} spread must be applied to the drag handle element
  expect(src).toMatch(/\{\.\.\.listeners\}/);
  // It must appear inside a JSX element (not just destructured and unused)
  // Both attributes and listeners must be spread
  expect(src).toMatch(/\{\.\.\.attributes\}/);
  expect(src).toMatch(/\{\.\.\.listeners\}/);
  
  // Count that listeners appears in JSX context (after <div or similar)
  const jsxListenersUse = src.match(/<[a-zA-Z][^>]*\{\.\.\.listeners\}[^>]*>/g);
  expect(jsxListenersUse).not.toBeNull();
  expect(jsxListenersUse!.length).toBeGreaterThanOrEqual(1);
});
```

Mutation to verify: delete `{...listeners}` from the drag handle element → `jsxListenersUse` is null → MUST FAIL.

### Option B — Less aggressive mock

If the test uses `vi.mock('@dnd-kit/core', ...)`, change the mock to a passthrough that still calls through to real implementation for `useSortable`, or mock only the `DndContext` wrapper while letting `useSortable` return real data including `listeners`.

Read the existing test first to decide which approach is cleanest.

### Step 2 — Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f035-stacked-reorder.test.tsx
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F101-handoff.md`.
