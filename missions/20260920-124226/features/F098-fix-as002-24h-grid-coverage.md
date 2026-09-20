# F098: Fix AS-002 — add 24-hour week grid coverage

**Milestone:** M7 follow-up (scrutiny pass 2 FAIL)

## Problem

AS-002 asserts: when a single person is selected, the week view shows a full 24-hour grid (not the 08:00–16:00 stacked window). The scrutiny found that `week-time-grid.tsx:67` sets `length: 24`, but mutating it to `9` survives all tests — the 24-hour half of AS-002 has zero coverage.

## What AS-002 asserts (from validation-contract.md)

When `selectedUserIds.length === 1`, the calendar shows a 24h × 7-day grid (full week view), not the 08:00–16:00 stacked window.

## Fix

### Step 1 — Locate the time grid component

Read `components/calendar/week-time-grid.tsx` (or equivalent). Find the line that sets the number of hours (e.g., `length: 24`).

### Step 2 — Add a unit test

In `tests/unit/` (create `f031-page-layout-derivation.test.tsx` or a new file `f098-week-grid-24h.test.tsx`), add a test:

```ts
it("test_AS_002_single_person_shows_24h_grid", () => {
  // Read week-time-grid.tsx source
  const src = fs.readFileSync(
    path.join(process.cwd(), "components/calendar/week-time-grid.tsx"),
    "utf-8"
  );
  // Must contain exactly 24 hours
  expect(src).toMatch(/length\s*:\s*24/);
  // Count occurrences — must be exactly the time-slot array, not incidental
  const matches = src.match(/length\s*:\s*(\d+)/g) ?? [];
  const hourLength = matches.find(m => m.includes("24"));
  expect(hourLength).toBeDefined();
});
```

Better approach: render the component with a mock and count the time-slot elements.

```ts
import { render, screen } from "@testing-library/react";
import WeekTimeGrid from "@/components/calendar/week-time-grid"; // adjust path

it("test_AS_002_single_person_shows_24h_grid", () => {
  render(<WeekTimeGrid hours={24} />); // or whatever props it takes
  const slots = screen.getAllByRole("rowheader"); // or whatever role the hour labels have
  expect(slots).toHaveLength(24);
});
```

Read the component first to understand its actual props and structure, then write the most direct test possible.

Mutation to verify: change `length: 24` (or equivalent) to `length: 9` → the test MUST FAIL.

### Step 3 — Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run # targeted to the new test file
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F098-handoff.md`.
