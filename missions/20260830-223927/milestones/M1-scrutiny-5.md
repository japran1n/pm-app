# M1 Scrutiny — pass 5 (after F022, F023)

Mission: 20260830-223927
Reviewed commits: 58625bf (F022), 76ceac2 (F023)
Reviewer: scrutiny validator (read-only; working tree verified clean of code changes at exit)
Prior reports: `M1-scrutiny.md` (8/6), `-2` (13/1), `-3` (11/3), `-4` (13/1)

## Verdict: **PASS (conditional)** — 14/14 assertions met, 0 blockers, 4 major follow-ups

Pass 4's single blocker is genuinely repaired and **independently reproduced by this reviewer**,
not taken on the handoff's word:

- **AS-013 revert is now discriminating.** Injecting a `setTodos(... isDone: intendedIsDone ...)`
  on the `!result.ok` path of `handleToggle` — so a *failed* toggle is permanently committed and
  never reverts — now **fails** `f006:111`
  (`expected aria-checked="false", received "true"`). In pass 4 this exact mutant left 8/8 green.
  `flushPendingTransitions()` (`f006:20-24`) forces the assertion past the `useOptimistic`
  transition boundary, so it observes settled state rather than the transient frame.
- **AS-012/AS-014 guard is still durable.** The `useOptimistic`→pass-through mutant fails 7/8;
  `markCommitted` no-op fails 2; the render-phase guard deletion still fails a test. F022 also
  replaced F020's freeze-forever value-equality release with commit-ordered release and cleared
  the guard in `handleDelete`, closing pass-4 Systemic 2.
- **AS-005/AS-007 are unaffected as worded** and remain killed by the `setOptimisticStatus` /
  `setOptimisticPriority` removal mutants (all 3 f003 and all 4 f004 tests die).

`tsc` exit 0. Lint 0 errors / 13 pre-existing warnings. 1418/1418 unit tests pass across 186 files.

I am recording PASS because every assertion as literally worded is met and mutation-verified.
I am recording it as *conditional* because three of F023's and F022's own stated guarantees are
protected by nothing (Majors 1–3 below) — the code is right today for reasons the test suite
cannot detect, and a refactor would silently regress it.

## Assertion results

| ID | Result | Reason |
|---|---|---|
| AS-001 | PASS | Never-resolving `editTask` (`list-priority-select-optimistic.test.tsx:83`); killed by moving `setOptimisticValue` after the `await` and by the `useOptimistic`→`useState` swap. Files unchanged since pass 4 (`git diff 8872857..HEAD` empty); result carried forward. |
| AS-002 | PASS | Both failure shapes covered; revert and toast mutants killed on the `{ok:false}` test. The throw test at `:115` still uses an already-settled `mockRejectedValue` and is individually weak (Major 4). |
| AS-003 | PASS | `list-due-date-cell-optimistic.test.tsx:79`, never-resolving mock; killed by both immediacy mutants. Unchanged since pass 4. |
| AS-004 | PASS | F021's deferred three-phase shape; killed by no-auto-revert at `:129`/`:172`, toast removal at `:131`/`:174`, and `try/catch` deletion. Covers set-a-date and clear-to-null failure. |
| AS-005 | PASS | Removing `setOptimisticStatus(next)` kills all 3 f003 tests; the new value is asserted while `moveTaskStatus` is unresolved. **Caveat (Major 1):** F023's post-success hold is *not* discriminating, and f003 still stubs `SelectValue: () => null` so "badge" is really a value binding. |
| AS-006 | PASS | Toast removal and `catch`-block deletion each kill a test; both `{ok:false}` and thrown shapes covered, and the throws test starts from a distinct base status so the revert cannot pass trivially. |
| AS-007 | PASS | Removing `setOptimisticPriority(next)` kills all 4 f004 tests; the F014/F018 null-collapse test asserts rendered badge *text* ("No priority"), not just the bound value. Same Major 1 caveat on the post-success hold. |
| AS-008 | PASS | Killed by the optimistic-removal, toast-removal, and `catch`-deletion mutants; both failure shapes covered with a distinct base priority. |
| AS-009 | PASS | Removing the `title-saving-indicator` Loader2 kills `f005:120-140`; presence *and* absence are asserted around a manually-resolved promise, so an always-on indicator fails too. |
| AS-010 | PASS | Four independent mutants killed: `setTitle(previousTitle)` deleted from the `ok:false` branch, from the `catch`, and both error toasts removed. |
| AS-011 | PASS (weak) | Removing the Enter→blur delegation kills the test; Escape-cancel asserts `editTask` was not called. The "no separate dialog" half is only structural (no dialog exists to assert against) and the blur-commit path is covered only incidentally. |
| AS-012 | PASS | `useOptimistic`→pass-through fails 7/8; `markCommitted` no-op fails 2; guard deletion fails the mid-toggle title-leak test. F022's commit-ordered release removes the pass-4 permanent-freeze regression. |
| AS-013 | PASS (was **FAIL/blocker**) | **Repaired and independently verified.** The commit-the-failure mutant now fails `f006:111`; toast removal on the `!ok` path, toast removal in the `catch`, and substituting `result.error` for the fixed copy each kill a test. Both failure shapes covered. Residual: the `clearPending()` leak (Major 2) is still invisible. |
| AS-014 | PASS | Symmetric to AS-012 and killed by the same mutants; covered independently at `f006:131` and `f006:247`. |

Totals: **14 PASS / 0 FAIL**. Previously 13/1.

## Systemic findings

### Major 1 — F023's confirmed-value *read* is dead to the test suite (AS-005, AS-007)
`setConfirmedStatus(next)` / `setConfirmedPriority(next)` are killed by mutation, but the bindings
that *display* them are not. Independently reproduced by this reviewer: changing
`task-detail-sheet.tsx:1476` from `value={confirmedStatus ?? optimisticStatus ?? task.status}` to
`value={optimisticStatus ?? task.status}` leaves **3/3 f003 tests green**; the equivalent removal of
the `confirmedPriority` branch leaves **4/4 f004 tests green**. So the post-success assertions
(`f003:203`, `f004:209`, `f004:330`) are detecting *that an extra state update happens inside the
transition scope*, not *that the confirmed value is what renders*. They are frame-sensitive in
exactly the way F022 just fixed in f006: they never flush past the transition boundary, so
`optimisticStatus` is still applied when they read. The snap-back guard F023 was written to install
would ship green if the read were refactored away. This is a test that mirrors the implementation
rather than the behaviour.

### Major 2 — the failure path still leaks a guard entry, and no test can see it (AS-013)
Removing `clearPending()` from the `!result.ok` path (`personal-todo-list.tsx:188`) **survives all
8 f006 tests**. Without it the entry stays `{isDone, committed:false}` forever, `markCommitted` is
never reached on a failure, and the merge branch at `:64` returns the *local* row for that id on
every subsequent `initialTodos` identity change — the row is permanently frozen against all future
server data, title and position included. This is the same permanent-freeze class F022 was written
to eliminate, still reachable through the error path. Nothing re-renders with new `initialTodos`
after a failed toggle, so the suite is blind to it.

### Major 3 — `confirmedStatus`/`confirmedPriority` freeze the sheet on same-task prop updates
The render-phase sync block (`task-detail-sheet.tsx:725`) gates on `task.id !== syncedTaskId`, so
the confirmed values are cleared only when a *different* task is synced in. If the **same** task's
prop later arrives with a peer- or server-changed status (board realtime, refetch), the Select stays
pinned to the stale local value: `confirmedStatus ?? optimisticStatus ?? task.status` puts the local
value ahead of the authoritative prop, with no timeout or generation check. Deleting *both*
`setConfirmedStatus(undefined)` / `setConfirmedPriority(undefined)` calls leaves **all 1418 unit
tests passing**, so even the documented "a freshly opened task never shows a stale confirmed value
from the previously open one" guarantee is untested. The same gate also freezes `title`, `dueDate`,
`startDate` and `descriptionJson` against same-id updates. Masked today only because
`use-task-detail-sheet.ts` refetches solely in `openTask`/`retry` — which M2's realtime work will
change. F023 fixed a snap-back by introducing a freeze; note this is structurally the same trade
F020 made and F022 had to undo.

### Major 4 — F022's tests encode a user-visible wart as expected behaviour (AS-012)
`f006:224-234` and `:278-288` now assert that the very next server payload after a successful commit
is accepted **unconditionally, even when stale** — i.e. the test asserts that a user who checks a box
sees it visibly *un-check itself* on the next refresh. That is a deliberate, documented race
trade-off, and it is the safer of the two options, but it is now locked in as expected behaviour and
would block a future fix that eliminates the flicker. Related: deleting the render-phase guard block
kills only the title-leak test at `:311`, not the two named guard-survival tests — guard coverage
rests on a single test, exactly the masking `:301-310` warns about.

### Minor — remaining gaps (unchanged or newly noted)
- Delete path in `personal-todo-list.tsx` is entirely untested: removing `setTodos(previous)` from
  the `!ok` branch survives 8/8 (a failed delete would silently vanish the row), and removing the
  `pendingToggles` clear at `:220-225` also survives. `deleteTodo` is mocked as always-`ok`.
  `handleDelete` still has no `try/catch` for thrown rejections.
- `handleCreate` (`:104`) has no coverage and no `try/catch`: a rejected `createPersonalTodo` leaves
  `isSubmitting` true forever, disabling the input permanently.
- `latestToggleRef` (`:131`) is still never pruned; no unmount cleanup for `pendingToggles`.
- f003 still stubs `SelectValue: () => null` (`:91`); F018's real mock was never ported from f004.
- `confirmIfMovingToDone` decline path, the `next === currentStatus` early returns, title
  empty/`>500`-char validation branches, `handleTitleBlur`'s no-op path, and `canEdit === false`
  disabling are all untested.
- `saveField` (`:718-736`) still has no optimistic mirror or revert;
  `handleToggleDescriptionChecklistItem` and `handleAssigneesToggle` still have no `try/catch`.
- `lib/hooks/use-optimistic-action.ts:46` still has a bare `catch {` discarding the error.
- `list-priority-select-optimistic.test.tsx:115` still uses a settled `mockRejectedValue`; FU-M asked
  for this and F022 did not do it.
- `disabled={isSaving}` on the list cells is asserted by nothing.
- Error-copy inconsistency in the to-do list; `result.error` still discarded at `:987`/`:1023`.
- FU-E (converge on the shared hook) never scheduled.

## Recommended follow-up features

**FU-P — Make the F023 confirmed-value read discriminating, and stop it freezing the sheet
(major, AS-005/AS-007).** F023 added `confirmedStatus`/`confirmedPriority` to
`components/task/task-detail-sheet.tsx` so the badge holds the new value after a successful save,
but only the *write* is tested: deleting `confirmedStatus ??` from the Select `value` binding at
`:1476` leaves all three f003 tests green, and the same for `confirmedPriority` at `:1504` across all
four f004 tests, because the post-success assertions never flush past the `useOptimistic` transition
boundary and so still read the optimistic value. Rewrite `f003:203`, `f004:209` and `f004:330` on the
same three-phase deferred shape F022 applied to f006 — assert the optimistic value while pending,
resolve `{ok:true}`, `await act(async () => {})` to flush, then assert the settled displayed value —
with the mechanical acceptance criterion that removing the `confirmed*` term from either `value`
binding must fail a test. In the same feature, fix the freeze this state introduces: the values are
cleared only when a different task id is synced (`:725`), so a same-task prop update carrying a
peer's status change is permanently ignored. Clear or supersede the confirmed value whenever an
incoming `task` prop disagrees after the commit (commit-ordering, mirroring F022's fix in the to-do
list), and add a test that a same-id prop update with a new status wins over a stale confirmed value.
Also port F018's real `SelectValue` mock from f004 into f003 so its badge claim is a badge claim.

**FU-Q — Close the to-do list's error- and delete-path holes (major, AS-013 residual).**
In `components/my-tasks/personal-todo-list.tsx`, removing `clearPending()` from the `!result.ok`
path survives all eight f006 tests, and without it the guard entry never gains `committed: true`, so
the row is frozen against every future server payload for the component's lifetime — the same
permanent-freeze class F022 was created to eliminate, reached through the failure path instead.
Add a test that fails a toggle and then re-renders with a fresh `initialTodos` identity carrying a
changed title and `isDone`, asserting the row picks the server data up. Cover the delete path, which
today has no test at all: removing `setTodos(previous)` from `handleDelete`'s `!ok` branch survives
8/8 (a failed delete silently loses the row), as does removing its `pendingToggles` clear. Add
failed-delete rollback and delete-during-in-flight-toggle tests, wrap `handleDelete` and
`handleCreate` in `try/catch` with a toast and rollback (`handleCreate` currently leaves
`isSubmitting` stuck true on a thrown rejection, permanently disabling the input), prune
`latestToggleRef`, and clear `pendingToggles` on unmount.

**FU-R — Finish the deferred-promise conversion and the residual error-handling gaps (minor/major).**
`tests/unit/list-priority-select-optimistic.test.tsx:115` still uses an already-settled
`mockRejectedValue` and never observes the optimistic `urgent` value — FU-K and FU-M both named it
and neither F021 nor F022 touched it; convert it to the deferred three-phase shape. Give `saveField`
(`task-detail-sheet.tsx:718-736`) revert-on-error parity with the title path; add `try/catch` to
`handleToggleDescriptionChecklistItem` (`:922`) and `handleAssigneesToggle` (`:1076`), both of which
currently produce an unhandled rejection with no toast and no revert; bind
`lib/hooks/use-optimistic-action.ts:46`'s bare `catch` to an error and `console.error` it; surface or
document-away the dropped `result.error` at `:987`/`:1023`; assert `disabled={isSaving}` on the list
cells; add tests for the title empty/`>500`-char validation branches, the `confirmIfMovingToDone`
decline path, and `canEdit === false` disabling; and reconcile the to-do list's error copy
(fixed string on toggle vs raw `result.error` on create/delete).

**FU-S — Decide and document the post-commit stale-sync trade-off (minor, AS-012).**
`f006:224-234` and `:278-288` now assert that the first server payload after a successful commit is
accepted even when it carries the pre-toggle value, meaning a user can watch a checkbox they just
checked un-check itself on the next refresh. This is the safer end of the freeze/flicker trade and
should not be reverted casually, but it is currently locked in as an expected-behaviour assertion
that would block any future fix. Either eliminate the window properly (server write returns the
committed row and the client reconciles on that, or a short generation/timestamp check that accepts
only payloads demonstrably post-dating the commit) or record the trade explicitly in the plan so a
later reviewer does not read the test as a specification. Note also that deleting the render-phase
guard block kills only the title-leak test at `:311`, not the two named guard-survival tests, so
guard coverage rests on one test — add a direct assertion of the guard's own effect.

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
(exit 0 — warnings only, all pre-existing)

### `npx vitest run tests/unit`
```
 Test Files  186 passed (186)
      Tests  1418 passed (1418)
   Start at  08:40:34
   Duration  40.20s (transform 3.64s, setup 0ms, import 82.92s, tests 31.58s, environment 24.85s)
```

Net test delta versus pass 4: 1418 → 1418 (+0). F022 rewrote the two f006 failure tests and extended
two guard tests; F023 replaced three no-op `await waitFor(() => {})` cleanups with real assertions.
No new `it(...)` blocks, so test count is again a useless signal — the mutation results above are the
evidence.

### Key mutation evidence (reproduced directly by this reviewer, not delegated)
```
MUTANT A — commit the failed value on the !ok path of handleToggle
  (personal-todo-list.tsx: add setTodos(... isDone: intendedIsDone ...) before clearPending())
  → KILLED. tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx:111
     expected aria-checked="false", received "true"
     Test Files 1 failed (1) | Tests 1 failed | 7 passed (8)
  (In pass 4 this same mutant left 8/8 green. AS-013's blocker is genuinely repaired.)

MUTANT B — drop the confirmed value from the status Select binding
  (task-detail-sheet.tsx:1476  value={confirmedStatus ?? optimisticStatus ?? task.status}
                            →  value={optimisticStatus ?? task.status})
  → SURVIVED. Test Files 1 passed (1) | Tests 3 passed (3)
  (F023's read path is untested — see Major 1.)
```

Working tree verified clean of code changes at exit: `git status --short` filtered to
`components/|tests/|lib/` returns nothing; only pre-existing `supabase/.temp/*` and `missions/*`
churn remains.

Note: `tests/integration/**` was again not run, for the same reason as all four prior reviews —
every M1 handoff attributes 50–90 failures there to live-Supabase rate limits. That claim remains
unverified across five passes and the integration suite is still not a gate this milestone can pass
or fail on. Recommend the orchestrator resolve this before M2.
