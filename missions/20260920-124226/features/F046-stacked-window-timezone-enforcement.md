# F046: enforce UTC in clipBlockToStackedWindow

**Milestone:** M1 follow-up (scrutiny pass 2)
**Estimated worker time:** 20 minutes
**Depends on:** F042

## Assertion IDs covered
- AS-021: block before 08:00 clipped to 08:00 (must be correct regardless of TZ env)
- AS-022: block after 16:00 clipped to 16:00 (must be correct regardless of TZ env)

## Problem
`new Date("2026-09-23T09:00:00")` (no Z) is parsed as LOCAL time by the JS engine.
Under `TZ=America/Los_Angeles` this is actually 16:00 UTC — appearing outside the window.
Under `TZ=Asia/Tokyo` a Saturday block could appear as Friday.
All current tests use Z-suffix so the suite is timezone-blind.

## Fix
At the top of clipBlockToStackedWindow, normalise the inputs:
```ts
function toUtcMs(s: string): number {
  // Reject offset-less strings by appending Z if no offset present
  const normalised = /[Z+\-]\d*$/.test(s) ? s : s.replace(" ", "T") + "Z";
  return new Date(normalised).getTime();
}
```
Use `toUtcMs(block.starts_at)` and `toUtcMs(block.ends_at)` throughout.
Update the doc comment: "Offset-less ISO strings are treated as UTC."

## Tests to add in planner-stacked-window.test.ts
Add a describe block "TZ invariance (AS-021/AS-022)" that explicitly tests:
- A block with no Z suffix `"2026-09-22T09:00:00"` (Monday) → same result as `"2026-09-22T09:00:00Z"`
- A block with space separator `"2026-09-22 09:00:00"` → treated as UTC
- Run vitest with explicit TZ override if possible (use `process.env.TZ = "America/Los_Angeles"` in beforeAll, restore in afterAll)
