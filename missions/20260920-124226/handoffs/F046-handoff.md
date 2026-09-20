# Handoff: F046 — enforce UTC in clipBlockToStackedWindow

## Status
COMPLETE

## Assertions covered
AS-021: PASS — block before 08:00 clipped to 08:00, verified correct regardless of TZ env (added TZ=America/Los_Angeles describe block)
AS-022: PASS — block after 16:00 clipped to 16:00, verified correct regardless of TZ env (added TZ=America/Los_Angeles describe block)

## Files changed
lib/calendar/stacked-window.ts
tests/unit/planner-stacked-window.test.ts

## Commands run
`npx vitest run tests/unit/planner-stacked-window.test.ts` (0) — 17 passed
`npx tsc --noEmit` (0) — clean

## Decisions made
- Implemented `toUtcMs` exactly as specified in the clarified spec, appending "Z" to offset-less strings and converting space separators to "T" first.
- Used `toUtcMs` to produce numeric ms values which are then wrapped in `new Date(...)` so the rest of `clipBlockToStackedWindow` (which relies on `Date` objects with `.getUTC*()` accessors) required no other changes.
- Updated the doc comment per spec: "Offset-less ISO strings are treated as UTC."
- Added a TZ invariance describe block that sets `process.env.TZ = "America/Los_Angeles"` in `beforeAll` and restores the original value in `afterAll`, per the spec's optional recommendation — vitest picked this up without issue so it was included (not skipped).

## Out-of-scope work needed
None identified within this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — spec was unambiguous and followed literally)

## Notes for the next worker
No MCP usage required for this feature (pure local TypeScript logic, no external service state touched). The regex `/[Z+\-]\d*$/` as given in the spec correctly detects trailing `Z`, `+HH:MM`/`+HHMM` and `-HH:MM`/`-HHMM` offsets; strings without these are treated as UTC per the fix. Full existing test suite for this file (17 tests) still passes alongside the 3 new TZ-invariance tests.
