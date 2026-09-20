# F049: fix toUtcMs for ±HH:MM offset formats (AS-022 blocker)

**Milestone:** M1 follow-up (M1-scrutiny-3 FU-12)
**Estimated worker time:** 20 minutes
**Depends on:** F007 (created the function)

## Assertion IDs covered
- AS-022: multi-day blocks are clipped to multiple segments (one per Mon–Fri day)

## Problem

`toUtcMs` in `lib/calendar/stacked-window.ts:26` uses this regex to detect whether
a string already has a timezone offset:

```ts
const normalised = /[Z+\-]\d*$/.test(s) ? s : s.replace(" ", "T") + "Z";
```

A canonical ISO offset ends in `:00` (e.g. `+00:00`, `+02:00`, `-05:00`).
The pattern `\d*$` requires only digits at the end, so it never matches the `+`/`-`
before `:00`. The guard misses, `"Z"` gets appended to a string that already has an
offset (e.g. `"2026-09-23T09:00:00+00:00Z"`), the parse fails, and the function
returns `[]` silently.

`+00:00` is exactly what PostgREST returns for `timestamptz`. The repo already pins
this format in `tests/integration/calendar-blocks-crud.test.ts:288`:
```
expect(updated.data.startsAt).toBe("2026-04-03T09:00:00+00:00")
```
So every block loaded from Supabase disappears from the stacked layout.

## Fix

Replace the regex with one that correctly identifies all timezone-bearing forms:
- `Z` or `z` suffix
- `±HH:MM` (canonical, what PostgREST emits)
- `±HHMM` (compact)
- `±HH` (short)

Simple correct approach: use `/[Zz]$|[+-]\d{2}(:\d{2})?(\d{2})?$/.test(s)` or
equivalently strip to check if `s` contains a `Z`, `z`, or `+`/`-` anywhere after
`T`/the time portion.

Even simpler: just try `new Date(candidate)` directly — if it's NaN, append `Z`.
Pseudocode:
```ts
function toUtcMs(s: string): number {
  const withT = s.replace(" ", "T");
  const ms = new Date(withT).getTime();
  if (!Number.isNaN(ms)) return ms;
  // offset-less: treat as UTC
  return new Date(withT + "Z").getTime();
}
```
This is simpler, correct, and covers all the forms the system can produce.

## Required tests in tests/unit/planner-stacked-window.test.ts

Add fixtures with:
- `2026-09-23T09:00:00+00:00` (PostgREST canonical — MUST produce a result, not `[]`)
- `2026-09-23T11:00:00+02:00`  (positive non-zero offset)
- `2026-09-23T05:00:00-05:00`  (negative offset)
- `2026-09-23t09:00:00z`  (lowercase — currently also broken)
- `2026-09-23T09:00:00.123456+00:00`  (microsecond precision)
- A mutation check: if `clipBlockToStackedWindow` is stubbed to return `[]` unconditionally,
  at least one test must fail.

## Gate

After the fix:
```bash
# Canonical offset must NOT return empty array
node -e "const {clipBlockToStackedWindow} = require('./lib/calendar/stacked-window.ts'); console.log(clipBlockToStackedWindow({starts_at:'2026-09-23T09:00:00+00:00',ends_at:'2026-09-23T10:00:00+00:00'}))"
```
Must output a non-empty array.

`npx vitest run tests/unit/planner-stacked-window.test.ts` must pass.
`npx tsc --noEmit` must be clean.
