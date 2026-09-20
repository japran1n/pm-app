# F106: Fix AS-069 — render-level capacity figure guard

**Milestone:** M7 follow-up (scrutiny pass 6 FAIL)

## Problem

F105 added a source-text sweep but it's not falsifiable: `` `${bookedHours}h total` `` passes the regex because the digit only appears at runtime. Template literals with variable interpolation escape all static regex patterns.

Also missing from the file list: `week-agenda.tsx` and `calendar-block-chip.tsx`.

## Fix

Replace the source-text regex approach with a **render-level test** that actually renders the components and checks the DOM output.

### Step 1 — Find what AS-069 tests

Read the current AS-069 test location (in `f036-stacked-scroll-colour.test.tsx` per F105's handoff).

### Step 2 — Render PlannerHeader with data

```ts
it("test_AS_069_no_capacity_figure_rendered_in_planner_header", () => {
  render(
    <PlannerHeader
      weekLabel="Sep 15–19"
      prevHref="/w/test/calendar?week=2026-W37"
      nextHref="/w/test/calendar?week=2026-W39"
      todayHref="/w/test/calendar"
      members={[
        { userId: "u1", name: "Alice", avatarUrl: null },
        { userId: "u2", name: "Bob", avatarUrl: null },
      ]}
      selectedUserIds={["u1", "u2"]}
      workspaceSlug="test"
      weekParam="2026-W38"
    />
  );
  
  const text = document.body.textContent ?? "";
  // Must not contain patterns that look like capacity figures
  expect(text).not.toMatch(/\d+\s*h\s*(total|booked|·)/i);
  expect(text).not.toMatch(/utili[sz]ation/i);
  expect(text).not.toMatch(/capacity/i);
  expect(text).not.toMatch(/\d+%\s*(load|booked|capacity)/i);
});
```

Read PlannerHeader's actual props to get the correct prop names.

### Step 3 — Also render StackedPersonRow 

```ts
it("test_AS_069_no_capacity_figure_rendered_in_stacked_row", () => {
  const blocks = [/* some test blocks */];
  render(<StackedPersonRow ... />);
  const text = document.body.textContent ?? "";
  expect(text).not.toMatch(/\d+\s*h\s*(total|booked)/i);
  expect(text).not.toMatch(/capacity/i);
});
```

### Mutation to verify

Add `<span>{bookedHours}h total · {loadPercent}% booked</span>` to PlannerHeader → render-level test MUST FAIL. Restore.

### Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f036-stacked-scroll-colour.test.tsx
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F106-handoff.md`.
