# F116: Fix AS-069 — render-level guard (FINAL ATTEMPT before DEFER)

**Milestone:** M7 follow-up (scrutiny pass 9 FAIL)
**Loop guard:** This is attempt 5 of 5. If this fails, AS-069 will be DEFERRED.

## Problem

Scrutiny pass 9 found live code in `components/calendar/stacked-person-row.tsx:140`:
```tsx
<div className="mb-1 text-sm font-medium">{userLabel} <span>{blocks.length * 8}h</span></div>
```

This renders a per-person hours total (`8h`, `16h`, etc.) in the stacked planner. All 10 AS-069 tests in `f036-stacked-scroll-colour.test.tsx` PASS because they only test source-text patterns that require a keyword next to the number (e.g., `/\d+h total/`). The bare `8h` passes undetected.

AS-069 assertion: "no hours total or capacity figure is displayed anywhere in the planner UI" (the feature hasn't been implemented yet, so any capacity figure is premature and should not appear).

## Fix — Two-part

### Part 1 — Remove the live capacity figure from the component

Read `components/calendar/stacked-person-row.tsx`. Find the div at line ~140 that renders `{blocks.length * 8}h` or similar capacity figures. Remove or comment out that specific `<span>` element (or the entire div if it only contains capacity data).

If the div contains other useful information, keep what's needed and remove only the capacity figure.

### Part 2 — Replace source-text regex with render-level DOM assertion

In `tests/unit/f036-stacked-scroll-colour.test.tsx`, find the AS-069 test that does source-text regex sweeps. Replace or supplement it with a render-level test:

```ts
it("test_AS_069_no_capacity_figures_rendered_in_planner", async () => {
  // Render StackedPlanner with sample blocks
  const { container } = render(
    <StackedPlanner
      selectedUserIds={["alice-id", "bob-id"]}
      members={testMembers}
      blocks={testBlocks}
      weekKey="2026-09-14"
    />
  );
  
  // Get all text content from the rendered output
  const textContent = container.textContent ?? "";
  
  // Must not contain bare capacity figures like "8h", "16h", "40h total", "80%"
  // Allow time formats like "10:00", "08:30", "16h30" (time, not capacity)
  // The pattern: a digit followed by 'h' NOT preceded by ':' and NOT followed by ':'
  const bareHourPattern = /(?<!:)\b\d+h\b(?![\d:])/g;
  const matches = textContent.match(bareHourPattern) ?? [];
  
  expect(matches).toHaveLength(0);
  // If this fails, it means a capacity figure leaked into the rendered output
});
```

### Mutation verification

Add back the `{blocks.length * 8}h` span → the render-level test MUST FAIL. Remove it → test MUST PASS.

### Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f036-stacked-scroll-colour.test.tsx
```

### Commit

```
git add -A
git commit -m "fix(F116): AS-069 remove capacity figure from stacked-person-row; add render-level guard test

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Handoff at `missions/20260920-124226/handoffs/F116-handoff.md`.
