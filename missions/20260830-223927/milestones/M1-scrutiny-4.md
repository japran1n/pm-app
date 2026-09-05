# M1 Scrutiny — pass 4 (after F020, F021)

Mission: 20260830-223927
Reviewed commits: c924fe6 (F020), 8872857 (F021)
Reviewer: scrutiny validator (read-only; working tree verified clean of code changes at exit)
Prior reports: `M1-scrutiny.md` (8/6), `M1-scrutiny-2.md` (13/1), `M1-scrutiny-3.md` (11/3)

## Verdict: **FAIL**

Both pass-3 failures are genuinely repaired and mutation-verified: AS-004 now has
discriminating revert coverage (F021), and AS-012/AS-014's optimistic flip is durable past
the commit tick (F020). But this pass surfaces two new problems, one of them a blocker that
pass 3 got wrong:

- **AS-013's revert half has no discriminating test.** Independently reproduced: injecting a
  `setTodos(... isDone: intendedIsDone ...)` on the `!result.ok` path — so a *failed* toggle
  is permanently **committed** and never reverts — leaves **all 8** f006 tests green. Pass 3
  recorded this mutant as killed; that was incorrect. The `waitFor(aria-checked="false")` at
  `tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx:95-96` resolves during the
  intermediate frame where the base `todos` is already updated but the `useOptimistic` pending
  action is still applied (base `true` + flip = `false`), so it never observes the settled state.
- **F020's guard trades a revert bug for a freeze bug.** The guard releases only on value
  equality (`personal-todo-list.tsx:54-64`). If the server value never converges — another user
  toggles the row back, the write silently didn't persist, or the row is deleted — the row is
  frozen out of *every* future server sync for the component's lifetime, and because `:63-64`
  keeps the whole local row object, its title and position freeze too.

`tsc` exit 0, lint 0 errors / 13 pre-existing warnings, 1418/1418 unit tests pass. The gate
fails on coverage and correctness, not tooling.

## Assertion results

| ID | Result | Reason |
|---|---|---|
| AS-001 | PASS | Never-resolving `editTask` (`list-priority-select-optimistic.test.tsx:83`); killed by moving `setOptimisticValue` after the `await` and by the `useOptimistic`→`useState` swap. |
| AS-002 | PASS | Both failure shapes covered. Revert killed by the no-auto-revert mutant at `:127` and `:161`; toasts killed at `:130`/`:164`. (The throw test at `:115` is individually weak — see Systemic 3 — but the `{ok:false}` test carries the assertion.) |
| AS-003 | PASS | `list-due-date-cell-optimistic.test.tsx:79`, never-resolving mock; killed by both immediacy mutants. |
| AS-004 | PASS (was **FAIL**) | **F021 delivered.** Both tests now use deferred promises and assert the optimistic value while pending (`:129`, `:172`) before the revert. Killed by the no-auto-revert mutant at `:129`/`:172`, by toast removal at `:131`/`:174`, and by `try/catch` deletion at `:129`. Covers both set-a-date and clear-to-null failure. |
| AS-005 | PASS | 3/3 f003 tests killed by `useOptimistic`→`useState` and by binding the Select to `task.status`; new value asserted while `moveTaskStatus` is unresolved (`f003:193-195`). |
| AS-006 | PASS | Toast removal (`task-detail-sheet.tsx:987`), the `useState` swap, and deleting the status `try/catch` (`:972-995`) each kill a test. Both `{ok:false}` and thrown shapes covered. |
| AS-007 | PASS | All 4 f004 tests killed by the priority `useState` swap; the F014 null-collapse test (`f004:270-325`) asserts rendered badge *text*, not just the bound value. |
| AS-008 | PASS | Killed by toast removal (`:1023`), the `useState` swap, and deleting the priority `try/catch` (`:1017-1030`). |
| AS-009 | PASS | Forcing the indicator off (`:1398`) kills `f005:120-140`; presence and absence both asserted around a manually-resolved promise. |
| AS-010 | PASS | Four independent mutants killed: `setTitle(previousTitle)` deleted from the `ok:false` branch (`:789`), from the `catch` (`:793`), toast removed (`:790`), `try/catch` deleted (`:784-795`). |
| AS-011 | PASS | Removing the Enter→blur delegation (`:812`) kills the test; Escape-cancel asserts `editTask` was not called. No dialog exists on the commit path. |
| AS-012 | PASS (was FAIL) | **F020's guard is now durable and observable.** Making `setOptimisticIsDone` a no-op fails 7/8; the `useOptimistic`→`useState` swap fails 7; deleting the render-phase guard block (`:45-80`) for an unconditional `setTodos(initialTodos)` now fails 3 tests, where in pass 3 it failed only 1 and neither named test. Caveat: durability is bought with a permanent-freeze regression — see Systemic 2. |
| AS-013 | **FAIL (blocker)** | The revert half is not covered at all. Committing the failed value on the `!ok` path (so the checkbox stays flipped forever) leaves **8/8 tests passing** — independently reproduced by this reviewer, not just by inspection. The two toast halves are cleanly killed (`:166`, `:185`), so only the "reverts to its prior state" clause is unguarded. |
| AS-014 | PASS (was FAIL) | Symmetric to AS-012 and now genuinely covered: the `setOptimisticIsDone` no-op mutant, the `useState` swap, and the guard-deletion mutant each fail the AS-014 tests. |

Totals: **13 PASS / 1 FAIL (1 blocker, 0 major-as-assertion)**. Previously 11 PASS / 3 FAIL.

## Systemic findings

### 1. AS-013's revert assertion measures a transient frame (blocker)
`tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx:95-96` waits for `aria-checked="false"`
after the rejection, but with `useOptimistic` that string is briefly true even when the failed
value has been permanently committed, because the pending flip is still applied on top of the
already-updated base. The test therefore cannot distinguish "reverted" from "committed the
failure". Any fix must flush the transition (`await act(async () => {})` or a macrotask) and
assert the **settled** state, or assert that no committed change occurred. This is the same
vacuous-revert shape F017 and F021 corrected elsewhere; it was never applied to f006. Three
prior reports flagged `f006:103` as vacuous under a weaker mutant; the stronger commit-the-
failure mutant shows the problem is worse than reported.

### 2. Value-equality guard release freezes rows permanently (blocker-class, outside the literal wording of AS-012/AS-014)
`personal-todo-list.tsx:54-64` deletes a row's `pendingToggles` entry only when
`serverTodo.isDone === confirmedIsDone`. There is no timeout, generation counter, or
commit-ordering check, so non-convergence is unrecoverable:
- Another user (or another device) toggling the row back means the server will never report the
  confirmed value; the row is pinned to the local value for the component's lifetime.
- Because `:63-64` returns the entire `local` row rather than merging only `isDone`, the row's
  **title and position also freeze**. Empirically reproduced by the feature reviewer: after a
  successful check, five successive server payloads carrying `isDone:false` and a changed title
  were all ignored; the DOM kept both the stale checkbox and the stale title.
- `merged` maps over `initialTodos`, so a guarded row deleted server-side is dropped despite
  being "protected", while its map entry survives.
Only a remount recovers. No test covers any of this.

### 3. Guard leaks that are themselves freeze vectors (major)
- Deleting `clearPending()` from the `!ok` path (`:167`) **survives all 8 tests**. With that leak
  a failed toggle guards the row against a value the server will never report — i.e. Systemic 2.
- The stale-response early return (`:158`, `:180`) deliberately leaves the entry set, on the
  premise that "the newer request will settle it". If the newer request also early-returns, or
  the component unmounts mid-flight, the entry never clears. No unmount cleanup exists.
- `handleDelete` (`:193`) removes the row without clearing its `pendingToggles` entry. The map
  then permanently holds an id with no matching `serverTodo`, so `pendingToggles.size > 0`
  forever and **every** future sync is forced down the merge path.
- `latestToggleRef` (`:122`) is still never pruned.

### 4. Post-success snap-back on the detail sheet — now empirically confirmed (major, fourth report)
Previously theorised; this pass it was probed directly. After a **successful** `moveTaskStatus`,
the Select settles back to the pre-change value: `optimisticStatus`'s base is `task?.status`
(`task-detail-sheet.tsx:636`), and `components/task/use-task-detail-sheet.ts:64,80` sets `detail`
only inside `openTask` — there is no refetch, no `router.refresh()`, no realtime subscription for
this caller. So the badge shows "Done", then visibly reverts to "To do" while a success toast
reads "Status updated." Identical mechanism for priority (`optimisticPriority` → `undefined` →
stale `task.priority`). The comment at `:632-635` names a reconciliation path that does not exist.
All three success-path tests are blind to it: `f003:198-199` and `f004:204-205` end in
`await waitFor(() => {})` (a no-op) and `f005:139` asserts only the toast. AS-005/AS-007 as
literally worded still pass; the user-visible outcome is wrong.

### 5. Remaining coverage and quality gaps (major / minor)
- `list-priority-select-optimistic.test.tsx:115` still uses `mockRejectedValue` (already settled)
  and never observes the optimistic `urgent` value — it survives both immediacy mutants. FU-K
  named it; F021 fixed only the due-date and hook files.
- `f003` still stubs `SelectValue: () => null` (`:91`), so its "badge" claim is really a
  value-binding claim. F018 fixed exactly this in f004 and was not ported across.
- `disabled={isSaving}` (`list-due-date-cell.tsx:84`, `list-priority-select.tsx:132`) is the only
  mitigation for rapid concurrent changes and is asserted by nothing — removing it fails no test.
- `saveField` (`task-detail-sheet.tsx:718-736`) has no optimistic mirror and no revert: a failed
  due-date/start-date edit keeps the rejected local value after the error toast.
- `handleToggleDescriptionChecklistItem` (`:922`) and `handleAssigneesToggle` (`:1076`) have no
  `try/catch` — a thrown Server Action there gives an unhandled rejection with no toast and no
  revert. Same omission class F013 was created to fix.
- `handleDelete` in `personal-todo-list.tsx:191-199` has no throw handling: a rejected
  `deleteTodo` leaves the row optimistically removed with no toast and no rollback — reads as
  silent data loss.
- `lib/hooks/use-optimistic-action.ts:46` still has a bare `catch {` discarding the error, with no
  `console.error`. `:44`'s `result.error || errorMessage` also swallows an intentional `{error:""}`.
- Error-copy inconsistency in the to-do list: toggle uses fixed `"Failed to update task"`
  (`:166`, `:185`) while create (`:112`) and delete (`:197`) surface raw `result.error`.
- `task-detail-sheet.tsx:987`/`:1023` still discard the server's `result.error` for status and
  priority.
- Pass-3 minors still open: the misleading `:782` `previousTitle` comment; client-side title
  rejections (`:759-769`) untested; `confirmIfMovingToDone` (`:967`) never exercised;
  `getMentionCandidates` mock shape mismatch in f003/f004/f005; AS-011's "no dialog" asserted only
  structurally; FU-E (converge on the shared hook) never scheduled.
- `test_AS_012_AS_014_in_flight_row_is_not_clobbered_by_a_stale_sync_mid_toggle` (`f006:292`)
  asserts *title preservation* on a guarded row — which Systemic 2 shows is the bug, now locked in
  as expected behaviour.

## Recommended follow-up features

**FU-M — Give AS-013's revert clause a test that survives no implementation (blocker, AS-013).**
The "checkbox reverts to its prior state" half of AS-013 is currently unguarded: committing the
failed value on the `!result.ok` path of `handleToggle` in
`components/my-tasks/personal-todo-list.tsx` leaves all eight tests in
`tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx` green, because the `waitFor` on
`aria-checked="false"` at `:95-96` resolves during a transient frame in which the `useOptimistic`
pending flip is still layered on an already-updated base. Rewrite both failure tests (the
`{ok:false}` one and the thrown-rejection one) to use a deferred promise, assert the *flipped*
optimistic value while the action is pending, then settle the rejection, **flush the transition**
(`await act(async () => {})` or an equivalent macrotask boundary) and assert the settled DOM state
— not merely a value reachable mid-transition. The acceptance criterion is mechanical and must be
verified by the implementer: adding a `setTodos` that commits `intendedIsDone` on the `!ok` path
must fail these tests, and deleting `clearPending()` from that same path must also fail at least
one test. While there, apply the same deferred three-phase shape to
`tests/unit/list-priority-select-optimistic.test.tsx:115`, which still uses an already-settled
`mockRejectedValue` and survives both immediacy mutants. Assertions touched: AS-002, AS-013.

**FU-N — Replace value-equality guard release with commit-ordering, and stop guarded rows freezing (blocker-class, AS-012/AS-014).**
F020 made the to-do list's committed state durable but release now depends on the server eventually
reporting the confirmed value (`components/my-tasks/personal-todo-list.tsx:54-64`), which is not
guaranteed: a concurrent toggle by another user, a write that silently did not persist, or a
server-side deletion pins the row for the component's lifetime — and since `:63-64` keeps the whole
local row object, the row's title and position freeze along with its checkbox. Replace equality-based
release with ordering-based release: stamp each local commit with a monotonic sequence number or
timestamp, keep the local `isDone` only for server payloads that demonstrably pre-date that commit,
and release unconditionally on the first payload that post-dates it. Merge only `isDone` from local
state, taking every other field from the server. Close the leaks in Systemic 3: clear the entry on
unmount, in `handleDelete` (`:193`), when a guarded id disappears from `initialTodos`, and on the
stale-response early-return paths (`:158`, `:180`) once no newer request remains outstanding; prune
`latestToggleRef` alongside. Add tests for each: (a) a guarded row released by a newer server payload
that disagrees, (b) a deleted guarded row not permanently forcing the merge path, (c) a guarded row's
title update from the server applying while its `isDone` is still guarded, (d) unmount mid-flight.
Also fix `handleDelete` to catch thrown rejections and roll back with a toast. Assertions touched:
AS-012, AS-013, AS-014.

**FU-L (re-issued, fourth report) — Cover and correct the post-success settle path on the detail sheet (major).**
Now confirmed by direct probe rather than inference: after a successful status change the Select
settles back to the pre-change value, because `optimisticStatus`'s base is `task?.status`
(`components/task/task-detail-sheet.tsx:636`) and `components/task/use-task-detail-sheet.ts:64,80`
updates `detail` only in `openTask` — no refetch, no `router.refresh()`, no realtime subscription
exists for this caller, contradicting the comment at `:632-635`. Priority behaves identically. Decide
the reconciliation contract explicitly (invoke the caller's update callback, refresh, or hold the
optimistic value until a matching prop arrives) and add success-path tests that resolve `{ok:true}`
and assert the new value HOLDS — the existing ones end in a no-op `await waitFor(() => {})`. While
there, address Systemic 5: port F018's real `SelectValue` mock from f004 into f003 so its badge claim
is a badge claim; give `saveField` (`:718-736`) revert-on-error parity; add `try/catch` to
`handleToggleDescriptionChecklistItem` (`:922`) and `handleAssigneesToggle` (`:1076`); bind
`lib/hooks/use-optimistic-action.ts:46`'s catch to an error with a `console.error`; surface or
document-away the dropped `result.error` at `:987`/`:1023`; assert `disabled={isSaving}` on the list
cells; and fix the misleading comments at `:782` and `personal-todo-list.tsx:76-81`. Assertions
touched: AS-005, AS-006, AS-007, AS-008.

## Command output

### `npx tsc --noEmit`
```
(no output — exit 0)
```

### `npm run lint`
```
> pm-app@0.1.0 lint
> eslint

/Users/sasajapranin/Desktop/pm-app/components/chat/message-list.tsx
   22:26  warning  'SmilePlus' is defined but never used                @typescript-eslint/no-unused-vars
  161:5   warning  Unused eslint-disable directive (no problems were reported from 'react-hooks/exhaustive-deps')

/Users/sasajapranin/Desktop/pm-app/tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx
  98:4   warning  '_taskId' is defined but never used  @typescript-eslint/no-unused-vars
  98:21  warning  '_status' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx
  104:4   warning  '_taskId' is defined but never used   @typescript-eslint/no-unused-vars
  104:21  warning  '_updates' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/f005-task-detail-sheet-title-optimistic.test.tsx
  36:4   warning  '_taskId' is defined but never used   @typescript-eslint/no-unused-vars
  36:21  warning  '_updates' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx
  25:4  warning  '_input' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/palette-actions-recents.test.tsx
  55:36  warning  '_workspaceId' is defined but never used  @typescript-eslint/no-unused-vars
  55:58  warning  '_query' is defined but never used        @typescript-eslint/no-unused-vars
  74:41  warning  '_workspaceId' is defined but never used  @typescript-eslint/no-unused-vars
  74:63  warning  '_pointers' is defined but never used     @typescript-eslint/no-unused-vars

✖ 13 problems (0 errors, 13 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

### `npx vitest run tests/unit`
```
 Test Files  186 passed (186)
      Tests  1418 passed (1418)
   Start at  08:15:01
   Duration  39.17s (transform 3.90s, setup 0ms, import 81.32s, tests 31.69s, environment 23.64s)
```

Net test delta versus pass 3: 1418 → 1418 (+0). F020 rewrote two f006 tests and added coverage in
place; F021 rewrote four assertions in two files. No new `it(...)` blocks. Test *count* is therefore
a useless signal this pass; the mutation results above are the evidence.

Working tree verified clean of code changes at exit (`git status` shows only pre-existing
`supabase/.temp/*` churn and untracked mission files).

Note: `tests/integration/**` was again not run, for the same reason as all three prior reviews —
every M1 handoff attributes 50–90 failures there to live-Supabase rate limits. That claim remains
unverified across four passes and the integration suite is still not a gate this milestone can pass
or fail on. Recommend the orchestrator resolve this before M2.
