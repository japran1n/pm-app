# F062: fix remaining test mislabels (major, AS-135)

**Milestone:** M2 follow-ups
**Estimated worker time:** 15 minutes
**Depends on:** F055

## Assertion IDs covered
- AS-135

## Clarified implementation
(Inherited from F014)

## Follow-up scope (from M2-scrutiny-3.md — FU-M2-20)
Three test labels persist incorrectly in `lib/webflow-converter/css.test.ts`:

1. Lines ~124 and ~131: labeled `AS-051` but actually testing breakpoint variant keys
   → Change label to the correct assertion ID for what the test actually tests
   (breakpoint mapping or variant creation)

2. Line ~171: labeled `AS-052` but actually testing combo classes
   → Change label to the correct assertion ID for combo class behavior

AS-051 and AS-052 are HTML-side assertions (M3, not yet implemented). They must
read as UNCOVERED until M3 lands. Having tests labeled with these IDs makes the
F039 coverage audit report them as covered when they are not.

Also:
- Delete or clearly mark the two constant-mirroring tests that assert a module's
  literals against copies of themselves (they cannot fail for any reason a user
  would care about):
  - `css.test.ts:75` — `STATE_ALIASES` deep-equals its own literal
  - `breakpoints.test.ts:92` — `BREAKPOINTS` deep-equals its own literal

Read the files carefully to find the exact line numbers (they may have shifted
from reported numbers due to prior edits).

## Definition of done
- No test in lib/webflow-converter/ is labeled AS-051 or AS-052
- Grep for AS-051 and AS-052 in lib/webflow-converter/ returns 0 matches
- The two self-confirming constant tests are gone
- All remaining tests pass
- tsc and lint clean
