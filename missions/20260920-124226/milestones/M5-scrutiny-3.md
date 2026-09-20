# M5 Scrutiny — Pass 3

Scope: re-check AS-044 / AS-045 after F065; regression sweep on AS-042, AS-043,
AS-046, AS-047/048/049, AS-050; tsc; eslint.

Verdict: **NOT GREEN** — assertions all pass, but the `eslint --max-warnings=0`
gate fails, and the offending line is inside the file F065 rewrote.

## Assertion table

| ID | Status | Reason |
|----|--------|--------|
| AS-042 | PASS | `tests/unit/f021-no-resize-other-blocks.test.tsx` green; resize handles gated on `canResize={canDrag && isOwnBlock(...)}` at week-time-grid.tsx:552. |
| AS-043 | PASS | `tests/unit/f022-no-drag-other-blocks.test.tsx` green against the real drag component (WeekBlockChip). |
| AS-044 | PASS | `f023-readonly-popover.test.tsx` renders the live `WeekTimeGrid`, clicks `calendar-week-block-chip-block-own`, asserts Save + Delete present. Not a prop-level restatement. |
| AS-045 | PASS | Same file clicks the other member's chip and asserts no Save, no Delete, plus the read-only note. **Mutation-verified** (below). |
| AS-046 | PASS | `f020-ownership-predicate.test.ts` green; both chips coexist in the AS-044/045 grid tests, own one stays editable while the other is read-only. |
| AS-047 | PASS | `f024-no-create-on-others.test.tsx` green. |
| AS-048 | PASS | `f024-no-create-on-others.test.tsx` green. |
| AS-049 | PASS | `f024-no-create-on-others.test.tsx` green. |
| AS-050 | PASS | `tests/integration/planner-block-write-rls.test.ts` — 2 tests **ran** (not skipped), confirming F064's `haveAdminCreds` env-order fix; direct UPDATE/DELETE against another member's block is refused server-side. |

Zero assertion FAILs.

## Mutation test (the pass-2 blocker)

`components/calendar/week-time-grid.tsx:553`, `isOwn={isOwnBlock(block, currentUserId)}`
-> `isOwn={true}`:

```
FAIL tests/unit/f023-readonly-popover.test.tsx >
  F065 ... > test_AS_045_other_members_block_hides_save_and_delete
expected document not to contain element, found <button type="submit">Save</button>
Test Files 1 failed (1) | Tests 1 failed | 3 passed (4)
```

The test dies when the wiring breaks. Pass-2 blocker on AS-044/AS-045 is
cleared. Source restored; `git diff --stat components/calendar/week-time-grid.tsx`
is empty.

Confirmed the test imports and renders `WeekTimeGrid` (line ~101), not the dead
`CalendarBlockChip`.

## Findings

### 1. Lint gate red — `minor` severity, but it blocks the stated gate

```
tests/unit/f023-readonly-popover.test.tsx
  29:10  warning  'makeBlock' is defined but never used
✖ 1 problem (0 errors, 1 warning)
ESLint found too many warnings (maximum: 0)
```

`makeBlock` is a leftover from the pre-F065 version of the file; the rewrite
added `makeGridBlock` and never removed its predecessor. Behaviourally inert,
but `npx eslint . --max-warnings=0` is non-zero, so the milestone cannot be
declared green as-is.

### 2. Pre-existing, out of M5 scope — `informational`

`tests/unit/f024-drag-cancellation.test.tsx` (3 failures,
`useArchitectureActions must be used within an ArchitectureActionsProvider`)
uses assertion IDs `AS-050` from a *different* mission's numbering — it is the
Architecture board, not the calendar. It broke in `c1b18217 refactor: decouple
Architecture board UI from server actions via context`, which predates M5 and
touches no calendar file. Not an M5 regression, but it is red on main.

The whole-suite run is `292 failed | 573 passed (867)` test files. This is a
broad pre-existing condition across the repo and not attributable to M5; every
M5-owned test file is green. It does mean the suite cannot serve as a
regression gate for future milestones until triaged.

## Recommended follow-up features

**F066 — remove the dead `makeBlock` helper.** Delete the unused `makeBlock`
factory and its now-unneeded `CalendarBlock` type import (if nothing else in
the file uses it) from `tests/unit/f023-readonly-popover.test.tsx`, so that
`npx eslint . --max-warnings=0` exits zero. No behavioural change; the four
tests in the file must still pass and the `isOwn={true}` mutation must still
kill `test_AS_045_other_members_block_hides_save_and_delete`. Scope is a
handful of lines in one test file.

**F067 — restore the Architecture board test harness.** `c1b18217` moved the
Architecture board's server actions behind `ArchitectureActionsProvider`
(`lib/architecture/actions-context.tsx`) but left `tests/unit/f024-drag-cancellation.test.tsx`
rendering `ArchitectureBoard` bare, so all three of its drag-cancellation tests
throw at `useArchitectureActions`. Wrap the renders in the provider with mocked
actions and assert the mocks are not called on a cancelled drag, preserving the
original intent (order unchanged, no server action fired, no-op on a null
`over` target). Out of M5's assertion scope; file separately.

**F068 — triage the 292 red test files.** The full suite is majority-red on
main, which makes "run the suite" worthless as a gate. Produce a categorised
inventory of the failures (shared-setup breakage vs. genuinely stale tests vs.
real regressions), then fix or explicitly quarantine each category, so that a
clean `npx vitest run` becomes a meaningful milestone gate again.

---

## Raw output

### `npx vitest run tests/unit/f023-readonly-popover.test.tsx`
```
Test Files  1 passed (1)
     Tests  4 passed (4)
  Duration  959ms
```

### Mutation run (`isOwn={true}`)
```
FAIL tests/unit/f023-readonly-popover.test.tsx > F065 (AS-044/AS-045):
  WeekTimeGrid/WeekBlockChip wires isOwnBlock(block, currentUserId) into the popover
  > test_AS_045_other_members_block_hides_save_and_delete
Error: expect(element).not.toBeInTheDocument()
expected document not to contain element, found <button type="submit">Save</button>
 ❯ tests/unit/f023-readonly-popover.test.tsx:115:64
Test Files  1 failed (1)
     Tests  1 failed | 3 passed (4)
```

### M5 regression set
```
npx vitest run f020-ownership-predicate f021-no-resize-other-blocks \
  f022-no-drag-other-blocks f023-readonly-popover f024-no-create-on-others \
  f024-drag-cancellation
Test Files  1 failed | 5 passed (6)
     Tests  3 failed | 15 passed (18)
(the 1 failed = f024-drag-cancellation, pre-existing Architecture board, see Finding 2)
```

### `npx vitest run tests/integration/planner-block-write-rls.test.ts`
```
Test Files  1 passed (1)
     Tests  2 passed (2)
  Duration  2.88s
```

### `npx tsc --noEmit`
```
(no output) — exit 0
```

### `npx eslint . --max-warnings=0`
```
/Users/sasajapranin/Desktop/pm-app/tests/unit/f023-readonly-popover.test.tsx
  29:10  warning  'makeBlock' is defined but never used.
                  Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)

ESLint found too many warnings (maximum: 0).
```
non-zero exit.

### Full suite (context)
```
Test Files  292 failed | 573 passed | 2 skipped (867)
     Tests  310 failed | 4520 passed | 1682 skipped (6512)
  Duration  176.07s
```
