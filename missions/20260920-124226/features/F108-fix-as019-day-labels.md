# F108: Fix AS-019 — day label rendering test

**Milestone:** M7 follow-up (scrutiny pass 6 FAIL)

## Problem

AS-019 asserts the stacked layout shows Mon–Fri column headers. Rotating `DAY_LABELS` to `["Sun", "Mon", "Tue", "Wed", "Thu"]` passes all tests because no test reads the rendered header text.

## Fix

### Step 1 — Find the existing AS-019 test

Grep for "AS_019" or "Mon" or "DAY_LABELS" in tests/unit/.

### Step 2 — Add rendered label assertion

```ts
it("test_AS_019_stacked_row_shows_mon_to_fri_labels", () => {
  render(<StackedPersonRow ... />); // or render StackedPlanner
  
  // Must contain exactly Mon, Tue, Wed, Thu, Fri in that order
  const headers = screen.getAllByRole("columnheader"); // or whatever role/testid
  const labels = headers.map(h => h.textContent?.trim());
  expect(labels).toContain("Mon");
  expect(labels).toContain("Fri");
  expect(labels).not.toContain("Sun");
  expect(labels).not.toContain("Sat");
  
  // Order check: Mon before Fri
  const monIdx = labels.indexOf("Mon");
  const friIdx = labels.indexOf("Fri");
  expect(monIdx).toBeLessThan(friIdx);
  expect(monIdx).toBeGreaterThanOrEqual(0);
});
```

Read the component to understand actual DOM structure and what labels are rendered.

Mutation to verify: rotate day labels to start with Sun → "Sun" appears in labels → `not.toContain("Sun")` MUST FAIL.

### Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run (targeted test file)
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F108-handoff.md`.
