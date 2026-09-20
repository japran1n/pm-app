# F112: Fix AS-014 — default week must not depend on viewer's timezone

**Milestone:** M7 follow-up (scrutiny pass 8 FAIL)

## Problem

Real code defect: `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx:102`:
```ts
parseWeekKey(weekParam) ?? currentWeekKey(timezone)
```
where `timezone` is the viewer's `profiles.timezone`. Two members with identical access opening the same URL without `?week=` can resolve different weeks near week boundaries (e.g. Sunday evening in Stockholm = Monday in UTC). AS-014 ("all members share the same calendar week") is violated.

## Fix

### Step 1 — Fix the source

In `page.tsx`, change the default week derivation to use UTC (or server time), not viewer timezone:

```ts
// Before:
const weekKey = parseWeekKey(weekParam) ?? currentWeekKey(timezone);

// After: UTC-based default so all viewers see the same week
const weekKey = parseWeekKey(weekParam) ?? currentWeekKey("UTC");
```

Read `lib/calendar/week-nav.ts` (or wherever `currentWeekKey` is defined) to understand the function signature. If it takes a timezone string, pass `"UTC"`. If it takes no arg, it already uses server time.

### Step 2 — Fix the F111 test (tautological)

The F111 test in `tests/unit/f102-calendar-page-composition.test.tsx` loops over user ids and asserts `expect(weekKey).toBe("2026-09-14")` — this is tautological. Replace with:

```ts
it("test_AS_014_default_week_is_utc_not_viewer_timezone", () => {
  // With no weekParam, both a UTC viewer and a LA viewer get the same week
  const utcWeek = currentWeekKey("UTC");
  const laWeek = currentWeekKey("America/Los_Angeles");
  
  // They may differ at week boundaries — but the page must use UTC
  // The real assertion: page.tsx uses "UTC", not a per-viewer timezone
  // So we test the currentWeekKey function is deterministic for a fixed zone
  expect(utcWeek).toMatch(/^\d{4}-\d{2}-\d{2}$/); // Monday date format
  
  // Mutation: change "UTC" to "America/Los_Angeles" in page.tsx
  // → near Sunday evening, utcWeek !== laWeek → test catches the timezone mismatch
});
```

More practically: add a source-text check that page.tsx does NOT pass `timezone` (the viewer's profile timezone variable) to `currentWeekKey`. Instead it must pass a literal `"UTC"` or nothing:

```ts
it("test_AS_014_page_uses_server_time_not_viewer_timezone", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx"),
    "utf-8"
  );
  // Must not pass the viewer's timezone variable to currentWeekKey
  // (the variable name is typically "timezone" or "viewerTimezone")
  expect(src).not.toMatch(/currentWeekKey\s*\(\s*(?:timezone|viewerTimezone|profile\.timezone)\s*\)/);
});
```

### Mutation

Revert the fix (pass `timezone` back) → source check MUST FAIL.

### Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f102-calendar-page-composition.test.tsx
npx next build
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F112-handoff.md`.
