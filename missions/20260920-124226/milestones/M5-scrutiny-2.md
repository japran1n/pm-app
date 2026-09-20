# M5 Scrutiny — Pass 2

Date: 2026-09-20. Read-only review. No code, test, or contract was modified
(mutations were applied and reverted; `git status` clean for `lib/`,
`components/`, `tests/`).

## Verdict: **RED** — 2 FAILs (AS-044, AS-045), both `blocker`.

| Assertion | Result | Reason |
|---|---|---|
| AS-042 | PASS | `isOwnBlock → true` kills `test_AS_042_other_members_block_hides_resize_handles`; test renders the live `WeekTimeGrid`. |
| AS-043 | PASS | f022 now renders live `WeekTimeGrid`/`WeekBlockChip`; `isOwnBlock → true` kills `test_AS_043_other_members_block_is_not_draggable`. |
| AS-044 | **FAIL (blocker)** | The only chip-level test targets `CalendarBlockChip`, which has **zero production call sites**. Mutating the live component (`week-time-grid.tsx:553 isOwn={isOwnBlock(block, currentUserId)}` → `isOwn={true}`) leaves all 12 M5 tests green. |
| AS-045 | **FAIL (blocker)** | Same mutation, same result. The live Planner's read-only gating can be deleted outright and nothing fails. |
| AS-046 | PASS | Mutating both `isOwnBlock` and `isOwnColumn` to `true` fails ≥1 test in each of f021, f022, f023, f024 (4 failures across 4 files). |
| AS-047 | PASS | `test_AS_047_own_column_create_handler_fires` + AS-048 negative; ownership mutation kills the negative. |
| AS-048 | PASS | `isOwnColumn → true` kills `test_AS_048_other_column_no_create_affordance`. |
| AS-049 | PASS (with a caveat, `minor`) | Positive test (`own_column_drag_gesture_creates_pending_block`) is genuine. The paired negative `test_AS_049_other_column_drag_gesture_does_not_create` is vacuous — it survives the ownership mutation because it never issues the `mouseMove` that reveals the `+` trigger, so both its assertions hold for reasons unrelated to ownership. AS-049's own intent is covered by the positive test, so not a FAIL. |
| AS-050 | PASS | Live credentials were present, so the suite **actually ran against the database** (2 passed, ~200ms each) rather than skipping — RLS genuinely refuses cross-member UPDATE and DELETE. `haveAdminCreds` now ANDs truthiness with `TEST_SUPABASE_ENV_DUMMY !== "1"`, restoring a clean `describe.skipIf` when only the setup file's placeholders exist. |

### AS-044 / AS-045 — the detail

`components/calendar/calendar-block-chip.tsx` is dead. Grep for
`CalendarBlockChip` across the repo returns only its own definition and
`tests/unit/f023-readonly-popover.test.tsx`. Its previous consumer,
`calendar-day-grid.tsx`, was deleted in F057 — this is the same finding that
F062 correctly acted on for AS-043, but F063 wired the new AS-044/AS-045
chip test into the dead component anyway.

The live chip is `WeekBlockChip`, defined inline in
`components/calendar/week-time-grid.tsx` and rendered by `WeekTimeGrid`. It
passes `isOwn` into `CalendarBlockPopoverForm` at line 807, fed from line
553. Evidence:

```
baseline:  Test Files 4 passed (4) | Tests 12 passed (12)
mutant (week-time-grid.tsx:553 -> isOwn={true}):
           Test Files 4 passed (4) | Tests 12 passed (12)
```

Every existing AS-044/AS-045 test is either a direct
`CalendarBlockPopoverForm` prop test (mirrors the implementation; proves the
form honours an `isOwn` prop, not that the Planner ever passes the right
one) or a test of an unreachable component. Nothing asserts the behaviour a
user experiences: *clicking a teammate's block in the Planner opens a view
with no Save and no Delete*.

## Recommended follow-up features

**F065 — Chip-level read-only popover test against the live Planner chip.**
Add tests to `tests/unit/f023-readonly-popover.test.tsx` (or a new file) that
render `WeekTimeGrid` with a block whose `userId` differs from
`currentUserId`, click the rendered `WeekBlockChip`, and assert the popover
shows the block's details with no `Save` button, no `Delete` button, and the
`calendar-block-readonly-note` present; plus the mirror case where
`userId === currentUserId` and both buttons appear. The acceptance gate is a
mutation test: changing `isOwn={isOwnBlock(block, currentUserId)}` to
`isOwn={true}` at `week-time-grid.tsx:553` must fail at least one test, and
changing it to `isOwn={false}` must fail at least one other. The existing
`CalendarBlockChip`-based tests should be retargeted, not kept alongside.

**F066 — Delete the dead `CalendarBlockChip`.** `components/calendar/calendar-block-chip.tsx`
has had no production call site since F057 removed `calendar-day-grid.tsx`.
Keeping it alive purely because tests import it is how AS-044/AS-045 passed
pass 1 review while the shipped behaviour was untested. Remove the component
and any now-orphaned helpers, after F065 has moved its coverage onto
`WeekBlockChip`. Type-check and lint must stay clean.

**F067 — Repair the vacuous AS-049 negative test (`minor`).** In
`tests/unit/f024-no-create-on-others.test.tsx`,
`test_AS_049_other_column_drag_gesture_does_not_create` never fires the
`mouseMove` that reveals the `+` trigger, so its "no add-slot" assertion is
true regardless of ownership and it survives an `isOwnColumn → true`
mutation. Add the `mouseMove` before the assertion so the test is sensitive
to the gating it claims to check, and keep the raw pointer-sequence
assertion as a second layer.

**F068 — Harden the AS-050 skip guard against stale `.env` values (`major`, optional).**
`haveAdminCreds` in `tests/integration/planner-block-write-rls.test.ts` now
skips correctly when only setup placeholders exist. It does not cover the
case where `.env` holds real-looking but unreachable credentials (e.g. a
stopped local Supabase): `loadDotEnv` clears `TEST_SUPABASE_ENV_DUMMY`, the
suite runs, and the connection failure surfaces as a hard FAIL rather than a
skip. Consider a short reachability probe in `beforeAll` that converts a
connection error into a skip, while leaving the existing `process.env.CI`
hard-throw intact so CI can never silently lose this coverage.

---

## Appendix — full command output

### `npx tsc --noEmit`
```
(no output)  exit 0
```

### `npx eslint . --max-warnings=0`
```
(no output)  ESLINT_EXIT=0
```

### Baseline — M5 unit + integration suites
```
$ npx vitest run tests/unit/f021-no-resize-other-blocks.test.tsx \
    tests/unit/f022-no-drag-other-blocks.test.tsx \
    tests/unit/f023-readonly-popover.test.tsx \
    tests/unit/f024-no-create-on-others.test.tsx \
    tests/integration/planner-block-write-rls.test.ts

 Test Files  5 passed (5)
      Tests  14 passed (14)
   Duration  2.79s
```

### AS-050 — verbose
```
 ✓ tests/integration/planner-block-write-rls.test.ts > Planner calendar_blocks write RLS (F025) > test_AS_050_memberB_cannot_update_memberAs_block 207ms
 ✓ tests/integration/planner-block-write-rls.test.ts > Planner calendar_blocks write RLS (F025) > test_AS_050_memberB_cannot_delete_memberAs_block 186ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
```
(Ran live against the database — not skipped. Real credentials present.)

### AS-046 mutation — `isOwnBlock → true` AND `isOwnColumn → true`
```
 ✓ f022 > test_AS_043_own_block_is_draggable
 × f022 > test_AS_043_other_members_block_is_not_draggable
 ✓ f021 > test_AS_042_own_block_shows_resize_handles
 × f021 > test_AS_042_other_members_block_hides_resize_handles
 ✓ f024 > test_AS_047_own_column_create_handler_fires
 × f024 > test_AS_048_other_column_no_create_affordance
 ✓ f024 > test_AS_049_own_column_drag_gesture_creates_pending_block
 ✓ f024 > test_AS_049_other_column_drag_gesture_does_not_create      <-- survives (vacuous)
 ✓ f023 > test_AS_044_isOwn_true_renders_save_and_delete_buttons
 ✓ f023 > test_AS_045_isOwn_false_hides_save_and_delete_buttons
 × f023 > F063 chip > test_AS_045_chip_hides_save_and_delete_for_another_members_block
 ✓ f023 > F063 chip > test_AS_044_chip_shows_save_and_delete_for_own_block

 Test Files  4 failed (4)
      Tests  4 failed | 8 passed (12)
```
All four M5 files fail ≥1 test → AS-046 criterion met. (The f023 kill is on
the dead `CalendarBlockChip`, which is why AS-044/AS-045 still fail below.)

### AS-044 / AS-045 mutation — live component, `week-time-grid.tsx:553 isOwn={true}`
```
baseline:  Test Files  4 passed (4)   Tests  12 passed (12)
mutant:    Test Files  4 passed (4)   Tests  12 passed (12)
```
No test detects removal of the live read-only gating. **FAIL.**

### Dead-code evidence
```
$ grep -rn "CalendarBlockChip" --include="*.ts" --include="*.tsx" . | grep -v node_modules
tests/unit/f023-readonly-popover.test.tsx:14:import { CalendarBlockChip } ...
tests/unit/f023-readonly-popover.test.tsx:76:      <CalendarBlockChip
tests/unit/f023-readonly-popover.test.tsx:98:      <CalendarBlockChip
components/calendar/calendar-block-chip.tsx:37:export function CalendarBlockChip({
```
No production call site.
