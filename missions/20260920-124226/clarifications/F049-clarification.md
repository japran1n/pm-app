# F049 clarification: toUtcMs fix

**Feature:** F049 — fix toUtcMs for ±HH:MM offset formats

## Clarified implementation

Use the try-parse approach: replace the regex with a direct `new Date().getTime()`
call, falling back to appending `Z` only when the first parse is NaN.

```ts
function toUtcMs(s: string): number {
  const withT = s.replace(" ", "T");
  const ms = new Date(withT).getTime();
  if (!Number.isNaN(ms)) return ms;
  return new Date(withT + "Z").getTime();
}
```

This handles:
- `2026-09-23T09:00:00Z` (Z suffix) ✓
- `2026-09-23T09:00:00z` (lowercase z) ✓  
- `2026-09-23T09:00:00+00:00` (PostgREST canonical) ✓
- `2026-09-23T09:00:00+02:00` (non-zero offset) ✓
- `2026-09-23T09:00:00-05:00` (negative offset) ✓
- `2026-09-23T09:00:00.123456+00:00` (microseconds) ✓
- `2026-09-23T09:00:00` (offset-less → UTC) ✓
- `2026-09-23 09:00:00` (space separator → UTC) ✓

## Test requirement

The test file must include `+00:00` and `+02:00` offset fixtures with a block
that falls within 08:00–16:00 on a weekday, and assert a non-empty result.

Must also include a mutation check comment indicating that stubbing
`clipBlockToStackedWindow` to always return `[]` would fail at least one test.

## Definition of done

- `clipBlockToStackedWindow({starts_at: "2026-09-23T09:00:00+00:00", ends_at: "2026-09-23T10:00:00+00:00"})` returns a non-empty array (Monday)
- All 17+ stacked window tests pass
- `npx tsc --noEmit` clean
- `npx eslint lib/calendar/stacked-window.ts tests/unit/planner-stacked-window.test.ts --max-warnings=0` clean
- Commit made
