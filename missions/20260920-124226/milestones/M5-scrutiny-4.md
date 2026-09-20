# M5 scrutiny — pass 4

Verdict: **GREEN**

All gates pass. Findings below are non-blocking.

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-042 | PASS | `canResize={canDrag && isOwnBlock(block, currentUserId)}` (week-time-grid.tsx:552). Mutation `canResize={canDrag}` → f021 test FAILS. |
| AS-043 | PASS | Week grid's only pointer-drag surface on an existing block is the two resize handles; gated by the same prop. Mutation → f022 drag test FAILS. See finding 2. |
| AS-044 | PASS | f023 `test_AS_044_own_block_shows_save_and_delete` renders own+other chips together via the live `WeekTimeGrid`, clicks the own chip, asserts Save/Delete. |
| AS-045 | PASS | Required mutation (`isOwn={true}`) makes `test_AS_045_other_members_block_hides_save_and_delete` FAIL. Non-vacuous. |
| AS-046 | PASS | `week-time-grid.tsx` imports `isOwnBlock`/`isOwnColumn` from `lib/calendar/ownership.ts` (line 64) and uses them at lines 208/552/553 — no inline `userId === currentUserId` anywhere in the file. Mixed-ownership coexistence exercised by the f023 F065 pair. |
| AS-047 | PASS | Mutation `isOwnColumn(...)` → `true` makes `test_AS_048_other_column_no_create_affordance` FAIL. |
| AS-048 | PASS | Same mutation; add-slot trigger absent on foreign column. |
| AS-049 | PASS | Own-column press-and-drag from the "+" trigger produces `calendar-week-drag-preview`. Weak on the release path — see finding 3. |
| AS-050 | PASS | `tests/integration/planner-block-write-rls.test.ts` ran against the live DB — 2 tests passed, **not skipped** (`Test Files 1 passed (1) / Tests 2 passed (2)`), and asserts both zero-rows-affected and the row's unchanged state via the admin client. |

No blockers. No majors on the assertions themselves.

## Findings (non-blocking)

**1. minor / process — the verification test paths in the pass-4 brief do not exist.**
Three of the five named files are wrong: `f020-thread-current-user-id.test.ts` (actual:
`tests/unit/f020-ownership-predicate.test.ts`), `f021-no-resize-other-blocks.test.ts` (actual `.tsx`),
`f024-no-create-other-column.test.ts` (actual: `tests/unit/f024-no-create-on-others.test.tsx`).
Vitest treats positional args as substring filters, so it silently ran only **3 files / 8 tests and
exited 0**. A green run against the brief's literal command would have been meaningless. Re-run with
the real paths: 5 files / 15 tests passed. Any future gate that names test files should use
`--dir`/exact paths plus an expected-file-count check.

**2. minor — AS-043 is satisfied by absence, not by a guard.**
`WeekBlockChip` has no move-drag gesture at all (no dnd-kit, no pointer "move" handler); the test
asserts the resize handles are gone. Correct today, but if M7's stacked layout adds real
drag-to-move, nothing in the current suite would catch an ungated one. Cheap insurance would be an
assertion that the foreign chip carries no `draggable`/`data-dnd` attribute and no pointer-move
handler that mutates time.

**3. minor — AS-049's negative case is not ownership-specific.**
`test_AS_049_other_column_drag_gesture_does_not_create` fires a raw pointer sequence on the column
surface. That sequence creates nothing on the signed-in member's *own* column either (creation can
only start from the "+" trigger), so that half of the test would pass regardless of ownership. The
ownership-bearing part is the `queryByTestId(add-slot)` assertion in the same test, which is
mutation-verified. The positive case also stops at the drag preview and never asserts the create
popover opens or `createCalendarBlock` is called on release.

**4. minor — `isOwnBlock`/`isOwnColumn` do not guard empty identifiers.**
Both are plain `===`. If `currentUserId` were ever `""` (an unauthenticated render) and a block's
`userId` were also `""`, the predicate returns `true` and grants edit affordances. Not reachable
today (`currentUserId` is a required prop sourced from the session), so no action required, but the
single-source-of-truth module is the right place for a non-empty invariant if that ever loosens.

## Recommended follow-up features

None required for M5 to close. If the orchestrator wants the two coverage gaps closed before M7
begins building on this grid, one small feature would cover both: extend
`tests/unit/f024-no-create-on-others.test.tsx` so the positive AS-049 case asserts the create popover
opens (or `createCalendarBlock` is invoked) on pointer release, and add to
`tests/unit/f022-no-drag-other-blocks.test.tsx` a structural assertion that a foreign block's chip
element exposes no drag attributes at all — so that when M7 introduces a genuine drag-to-move
gesture, an ungated implementation fails a test rather than quietly shipping. Neither touches
production code or the contract.

---

## Raw output

### `npx eslint . --max-warnings=0`
```
(no output)
ESLINT_EXIT=0
```

### `npx tsc --noEmit`
```
(no output)
TSC_EXIT=0
```

### M5 unit tests (corrected paths)
```
$ npx vitest run tests/unit/f020-ownership-predicate.test.ts \
    tests/unit/f021-no-resize-other-blocks.test.tsx \
    tests/unit/f022-no-drag-other-blocks.test.tsx \
    tests/unit/f023-readonly-popover.test.tsx \
    tests/unit/f024-no-create-on-others.test.tsx
 Test Files  5 passed (5)
      Tests  15 passed (15)
EXIT=0
```

### M5 unit tests (paths exactly as given in the brief — note the silent under-run)
```
 Test Files  3 passed (3)
      Tests  8 passed (8)
EXIT=0
```

### Mutation 1 (required): `isOwn={isOwnBlock(block, currentUserId)}` → `isOwn={true}`
```
 × test_AS_045_other_members_block_hides_save_and_delete 101ms
 FAIL tests/unit/f023-readonly-popover.test.tsx > F065 (AS-044/AS-045) ...
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
MUT_EXIT=1
```
File restored; `git diff --stat components/calendar/week-time-grid.tsx` empty.

### Mutation 2 (extra): `canResize={canDrag && isOwnBlock(...)}` → `canResize={canDrag}`
```
 FAIL tests/unit/f021-no-resize-other-blocks.test.tsx > test_AS_042_other_members_block_hides_resize_handles
 FAIL tests/unit/f022-no-drag-other-blocks.test.tsx  > test_AS_043_other_members_block_is_not_draggable
 Test Files  2 failed (2)
      Tests  2 failed | 2 passed (4)
```

### Mutation 3 (extra): `return isOwnColumn(columnUserId, currentUserId)` → `return true`
```
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
```
All mutations reverted; working tree for `components/calendar/week-time-grid.tsx` clean.

### AS-046 structural check
```
$ grep -n "isOwn\|isOwnColumn" components/calendar/week-time-grid.tsx
64:import { isOwnBlock, isOwnColumn } from "@/lib/calendar/ownership";
208:    return isOwnColumn(columnUserId, currentUserId);
552:                  canResize={canDrag && isOwnBlock(block, currentUserId)}
553:                  isOwn={isOwnBlock(block, currentUserId)}
```

### RLS integration
```
$ npx vitest run tests/integration/planner-block-write-rls.test.ts
 Test Files  1 passed (1)
      Tests  2 passed (2)
EXIT=0
```
Not skipped: `describe.skipIf(!haveAdminCreds)` resolved to run, and both
`test_AS_050_memberB_cannot_update_memberAs_block` and
`test_AS_050_memberB_cannot_delete_memberAs_block` executed against the live project.
