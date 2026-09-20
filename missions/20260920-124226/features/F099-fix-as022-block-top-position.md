# F099: Fix AS-022 — block top position must not survive hardcoded 0%

**Milestone:** M7 follow-up (scrutiny pass 2 FAIL)

## Problem

AS-022 asserts: in the stacked layout, a block's `top` CSS property is calculated from its start time relative to 08:00. The scrutiny found that the only render fixture's correct top *is* `0%` (block starts at 08:00), so hardcoding `top: 0%` or `top: "0%"` survives the test with no mutation. No fixture tests a non-zero top.

## Fix

### Step 1 — Find the existing test

Read `tests/unit/f033-stacked-person-row.test.tsx` (or the file that tests `StackedPersonRow`). Find the test for block positioning.

### Step 2 — Add a non-zero top fixture

Add a second fixture where the block starts at 10:00 (2 hours after 08:00). In an 8-hour window (08:00–16:00), 10:00 is 25% from the top.

```ts
it("test_AS_022_block_top_position_nonzero", () => {
  const block = {
    ...baseBlock,
    startTime: "10:00", // or ISO datetime at 10:00 on a Monday
    endTime: "11:00",
  };
  render(<StackedPersonRow ... blocks={[block]} ... />);
  const blockEl = screen.getByTestId("stacked-block") // or whatever testid is used
    || screen.getByRole("article");
  const style = blockEl.getAttribute("style") ?? "";
  // top should be ~25% (2h / 8h = 0.25 = 25%)
  expect(style).toMatch(/top:\s*25%/);
});
```

Read the component and existing tests first to get the exact prop shapes and test IDs.

Mutation to verify: replace the computed `top` with a hardcoded `"0%"` → this test MUST FAIL (0% ≠ 25%).

### Step 3 — Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f033-stacked-person-row.test.tsx
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F099-handoff.md`.
