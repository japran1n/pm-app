# M5 scrutiny — round 1

_Mission: 20260920-124226_  _Milestone: M5 (F020–F025)_  _Date: 2026-09-20_
_Reviewed at: `b9114b0f` (clean detached worktree)_

**VERDICT: RED** — 4 FAIL (1 blocker, 3 major).

---

## Assertion results

| ID | Result | Severity | Reason |
|---|---|---|---|
| AS-042 | PASS | — | Resize handles are conditionally *mounted* under `canDrag && isOwnBlock(...)` (`week-time-grid.tsx:552,749,778`); pointer listeners live on the handles themselves, so no listener survives the gate. Mutation-confirmed: forcing `isOwnBlock` true fails `test_AS_042_other_members_block_hides_resize_handles`. |
| AS-043 | FAIL | major | Behaviour is correct but only *vacuously* — `CalendarBlockChip`, the only component implementing the drag gate, has **no production call site** and no `DndContext` exists anywhere in `components/calendar/`. The test asserts only `data-draggable` and a `cursor-*` class, both derived from the same `canMove` variable; mutating `disabled: false` (`:78`) plus unconditional `{...listeners}` (`:128`) makes the chip fully draggable with **both tests still green**. No test fires a drag or asserts no mutation occurs. |
| AS-044 | FAIL | major | The no-save behaviour is correct (`calendar-block-popover-form.tsx:188-218`, plus `if (!isOwn) return;` at `:98` blocking Enter-submit). But the assertion's intent — *clicking another member's block* opens read-only — is never exercised. `f023-readonly-popover.test.tsx` renders `CalendarBlockPopoverForm` with a hand-fed `isOwn` prop, bypassing `isOwnBlock` entirely. Mutation-confirmed: forcing `isOwnBlock` to return `true` leaves **both F023 tests passing**. The chip→popover ownership wiring (`week-time-grid.tsx:553,807`) is untested; it could be inverted and the suite stays green. |
| AS-045 | FAIL | major | Same root cause. Delete button is genuinely unmounted in the `!isOwn` branch (`:190-200`), but `isOwn` arrives as a test-supplied prop, so the assertion as stated ("the read-only detail view for *another member's block*") is not exercised end-to-end. Also untested: the `:98` submit guard, and the disabled state of time inputs, colour swatches and the client-presentation checkbox. |
| AS-046 | **FAIL** | **blocker** | The single-predicate invariant is violated. `week-time-grid.tsx:207-209` re-implements the comparison inline as `canCreateInColumn(columnUserId) => columnUserId === currentUserId`, never calling `isOwnBlock`. Proof by mutation: rewriting `lib/calendar/ownership.ts` to `return true` breaks only F021 and F022 — **F023 and F024 stay green**, i.e. their affordances do not derive from the predicate. The module's own doc comment ("every M5 affordance … calls THIS predicate rather than re-deriving the `userId === currentUserId` check inline") is factually false as shipped. |
| AS-047 | PASS | — | The `+` trigger is render-gated (`:519-531`) and the column `<div>` (`:479-500`) carries no `onPointerDown`/`onClick`/`onDoubleClick`/`onKeyDown`, so there is no click-to-create bypass. Removing the `canCreateInColumn` term fails `test_AS_048_other_column_no_create_affordance`. (See fragility note below.) |
| AS-048 | PASS | — | `dragCreate` is set only in `handleColumnPointerDown` (`:258-259`), reachable only through the gated trigger; a drag straying across columns commits to the originating column's date. Server-side `lib/actions/calendar-blocks.ts` never accepts a caller-supplied `userId`. |
| AS-049 | PASS | — | `test_AS_049_own_column_drag_gesture_creates_pending_block` drives the real pointerdown→move→up path. `canDrag` is genuinely `true` in the test (`:138` `membership ? canWrite(...) : true`, membership mocked `null`), so the positive case is not vacuous. |
| AS-050 | FAIL | major | Owner-scoped RLS policies do exist (`supabase/migrations/20261107010000_calendar_blocks.sql:85-102`), never loosened by later migrations, and the test correctly distinguishes "RLS filtered" from "row missing" via an admin re-read (`:182-187`, `:200-205`). **But the test never runs locally and reports green.** `tests/setup/testing-library.ts:38-43` unconditionally backfills `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` plus dummy keys *before* the test's `loadDotEnv()`, whose `if (key && !(key in process.env))` guard then refuses to install the real `.env` values. Consequences: `haveAdminCreds` (`:39`) is always true, so the CI guard at `:40-44` is **dead code that can never fire**; the suite instead fails to reach the dead port, takes `skipDueToNetwork` (`:137-148`), and `beforeEach(ctx => ctx.skip())` silently skips both tests while the file is reported PASSED. The repo already has the correct idiom (`TEST_SUPABASE_ENV_DUMMY`, used by `tests/unit/fts-tasks.test.ts:60`) and this file does not use it. Evidence exists only under CI (`.github/workflows/ci.yml:162,215-217,251`). A silently-green skip is not evidence. |

---

## Additional findings (not assertion failures)

- **Fail-open column ownership (major risk).** `week-time-grid.tsx:478` uses `day.userId ?? currentUserId`, and `lib/calendar/week-grid.ts:114-117` never sets `userId`. So in production *every* column resolves to own and the gate is always-true. The default direction fails **open**: if M7 lands `userId` on most rows but misses one path (synthesized all-day row, stub day, optimistic insert), that column silently becomes writable rather than visibly broken.
- **Vacuous test assertion.** `tests/unit/f024-no-create-on-others.test.tsx:118-120` fires `pointerDown` directly on a foreign column claiming to "bypass the trigger entirely". It passes because the column div has no `onPointerDown` handler at all — it would pass identically with `canCreateInColumn` deleted. The handler-level gate at `:229` has zero coverage.
- **M7 forward-compat defect.** All per-column state is keyed by date alone, not `(date, userId)`: `hoveredSlot` (`:522`), `columnRefs.current[day.date]` (`:482`), `dragCreate.date`, `pendingCreate.date` (`:525`), `blocksState[day.date]` (`:537`). In a stacked layout two rows share a date — refs will alias, the `+` will render on every row for that date, and one person's blocks will render into every row.
- **Dead code.** `components/calendar/calendar-block-chip.tsx` is referenced only by its own test; its header cites a consumer `calendar-day-grid.tsx` that does not exist.
- **Cleanup leak.** `planner-block-write-rls.test.ts:156` returns early from `afterAll` on `skipDueToNetwork`, leaving workspaces/members/auth users behind if the failure occurs after creation; `:160` deletes by an `undefined` `workspace_id` if it occurs before.
- **a11y.** Resize handles are `aria-hidden`, pointer-only, non-focusable — no keyboard resize path even on own blocks.
- **Pre-existing/environmental.** `npx tsc --noEmit` reports one error, `app/layout.tsx(27,50): Cannot find name 'LayoutProps'` — a Next.js generated-types artifact absent from a fresh worktree (`next-env.d.ts` is modified in the main working tree). Not attributable to M5.

---

## Recommended follow-up features

**FU-1 — Collapse column ownership onto the single predicate (closes AS-046 blocker).** Extract a primitive `isOwnUser(userId: string | null | undefined, currentUserId: string): boolean` into `lib/calendar/ownership.ts` and redefine both `isOwnBlock` (as `isOwnUser(block.userId, currentUserId)`) and `week-time-grid.tsx`'s `canCreateInColumn` in terms of it, deleting the inline `columnUserId === currentUserId` comparison. Make the fallback fail-closed: replace `day.userId ?? currentUserId` with an explicit `userId` on every `CalendarWeekDay` produced by `buildCalendarWeek`, so an unlabelled column is a type error rather than a silently-writable one. Add a guard test that mutating the shared primitive to `return true` breaks at least one test in each of F021–F024; correct the now-false doc comment in `ownership.ts`.

**FU-2 — Behavioural wiring tests for the read-only popover (closes AS-044/AS-045).** Add tests that mount the real `WeekTimeGrid` with one own block and one teammate's block, click each, and assert on the resulting popover DOM: teammate's block yields no Save and no Delete button and a disabled title, own block yields both. These must derive `isOwn` through `isOwnBlock` rather than receiving it as a prop, so that mutating the predicate fails them. Add explicit coverage that programmatic/Enter-key form submission on a non-own block never calls `onSubmit` (the `:98` guard is currently untested), and that the time inputs, colour swatches and client-presentation checkbox are disabled.

**FU-3 — Make the drag-to-move gate real or retire the dead component (closes AS-043).** Either delete `components/calendar/calendar-block-chip.tsx` and record AS-043 as satisfied by the absence of any drag-to-move feature, or — if drag-to-move is intended — wire it into the live week view and replace the attribute-mirroring test with a behavioural one: mount inside a `DndContext`, fire a real drag gesture on a teammate's chip, and assert the block-update action is never invoked. The current test must not survive a mutation that sets `disabled: false` and spreads listeners unconditionally.

**FU-4 — Make the RLS integration suite fail loudly instead of skipping green (closes AS-050).** Teach `planner-block-write-rls.test.ts` to recognise the placeholder env installed by `tests/setup/testing-library.ts` using the existing `TEST_SUPABASE_ENV_DUMMY` flag, so `loadDotEnv()` overwrites the dummies with real `.env` values and `haveAdminCreds` reflects reality. The suite must then actually execute locally when credentials are present, and the CI guard at `:40-44` must become reachable — extend it so that a *network* skip also throws under CI, closing the silent-green path. Additionally assert that memberB *can* SELECT the target row before the UPDATE (so `data === []` is unconfounded evidence of a write rejection rather than an invisible row), fold in the INSERT-on-behalf case, and make `afterAll` clean up unconditionally and tolerate a partially-created fixture.

**FU-5 — Key per-column grid state by (date, userId) before the stacked layout lands.** Ahead of M7/F032, change `hoveredSlot`, `columnRefs`, `dragCreate`, `pendingCreate` and the blocks lookup in `week-time-grid.tsx` from date-only keys to composite `(date, userId)` keys, and add a test rendering two members' rows for the same date asserting that hover, the create trigger, block placement and ref measurement each affect exactly one row.

---

## Command output

### `npx vitest run` — M5 unit tests (clean worktree at HEAD)
```
 Test Files  5 passed (5)
      Tests  13 passed (13)
   Duration  1.57s
```

### Mutation check 1 — `isOwnBlock` forced to `return true`
```
 ✓ f022 > test_AS_043_own_block_is_draggable
 × f022 > test_AS_043_other_members_block_is_not_draggable
 ✓ f023 > test_AS_044_isOwn_true_renders_save_and_delete_buttons
 ✓ f023 > test_AS_045_isOwn_false_hides_save_and_delete_buttons
 ✓ f024 > test_AS_047_own_column_create_handler_fires
 ✓ f024 > test_AS_048_other_column_no_create_affordance
 ✓ f024 > test_AS_049_own_column_drag_gesture_creates_pending_block
 ✓ f024 > test_AS_049_other_column_drag_gesture_does_not_create
 ✓ f021 > test_AS_042_own_block_shows_resize_handles
 × f021 > test_AS_042_other_members_block_hides_resize_handles

 Test Files  2 failed | 2 passed (4)
      Tests  2 failed | 8 passed (10)
```
Interpretation: F023 and F024 are fully insensitive to the predicate — AS-046 blocker.
Mutation checks 3 (remove resize gate) and 4 (unconditional draggable) are subsumed by
this result: both F021 and F022 negative tests fail, so those gates are load-bearing.

### `npx vitest run tests/unit` (full suite, clean worktree at HEAD)
```
 Test Files  41 failed | 463 passed | 1 skipped (505)
      Tests  133 failed | 3229 passed | 3 skipped (3365)
   Duration  85.10s
```
Matches the stated pre-existing baseline of 41/133 exactly. No regression from M5.

### `npx tsc --noEmit`
```
app/layout.tsx(27,50): error TS2304: Cannot find name 'LayoutProps'.
```
Single error, pre-existing Next.js generated-types artifact of the fresh worktree; not M5.

### `npx eslint . --max-warnings=0`
```
(no output — clean, exit 0)
```

### `npx vitest run tests/integration/planner-block-write-rls.test.ts`
```
 ↓ test_AS_050_memberB_cannot_update_memberAs_block   (skipped)
 ↓ test_AS_050_memberB_cannot_delete_memberAs_block   (skipped)
 Test Files  1 passed (1)   Tests  2 skipped (2)   Duration 169ms
```
Skipped despite real Supabase credentials being present in `.env`, and reported as passed.
