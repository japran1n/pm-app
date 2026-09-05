# M1 Scrutiny — pass 3 (after F016, F017, F018, F019)

Mission: 20260830-223927
Reviewed commits: 7a89dfc (F016), aa6ff5e (F017), ff8eb09 (F018), 6744566 (F019)
Reviewer: scrutiny validator (read-only; working tree verified clean of code changes at exit)
Prior reports: `M1-scrutiny.md` (8 PASS / 6 FAIL), `M1-scrutiny-2.md` (13 PASS / 1 blocker)

## Verdict: **FAIL**

The AS-010 blocker from pass 2 is genuinely fixed and mutation-verified. AS-002, AS-006,
AS-007 and AS-008 are now backed by discriminating tests. But two of the four fixes did
not deliver what their commit messages claim, and mutation testing surfaced one previously
unrecognised coverage hole:

- **F019 did not fix the bug it names.** Its guard covers only the in-flight window. A
  stale `initialTodos` array arriving *after* a successful commit still silently reverts a
  checked to-do, with no toast. Reproduced empirically. Worse, the two tests F019 added
  that are *named* for AS-012/AS-014 refresh survival **pass with the entire guard
  deleted** — they are vacuous; only the third (title-leak) test has teeth, and it asserts
  on a field no assertion mentions.
- **AS-004's revert half has no discriminating test at all.** Replacing `useOptimistic`
  with `useState` in the shared hook — removing auto-revert entirely — leaves both
  due-date failure tests green.

`tsc` clean, lint 0 errors / 13 pre-existing warnings, 1418/1418 unit tests pass. The gate
fails on coverage and correctness, not tooling.

## Assertion results

| ID | Result | Reason |
|---|---|---|
| AS-001 | PASS | Moving `setOptimisticValue` after the `await`, and swapping `useOptimistic` for `useState`, each fail the test; mock never resolves during the assertion. |
| AS-002 | PASS | Both failure shapes covered. Deleting the hook's `try/catch` fails the throw test; deleting the `{error}` branch fails the restored `{ok:false}` test, which asserts `urgent` while pending *then* the revert to `medium` — genuinely discriminating. |
| AS-003 | PASS | Same two mutations kill the due-date immediacy test. |
| AS-004 | **FAIL (major)** | Failure *toasts* are covered, but neither failure test ever asserts the optimistic value before the revert, so both revert assertions are satisfiable at t=0. Proof: replacing `useOptimistic` with `useState` (no revert at all, value sticks forever) leaves both AS-004 tests passing. The implementation reverts correctly; nothing guards it. |
| AS-005 | PASS | `useOptimistic`→`useState` mutant killed (`expected 'todo' to be 'done'`); asserted while `moveTaskStatus` is unresolved. |
| AS-006 | PASS (was fragile) | F017 restructured the throw test to start at `in_progress`, move to `done`, assert `done` while pending, then assert the revert. Deleting the `try/catch` fails on the *revert* line; deleting only the toast fails on the toast line. Both halves independently covered. |
| AS-007 | PASS | F018's `SelectValue` mock now invokes the production render-prop. Reverting F014's ternary to `optimisticPriority ?? task.priority` fails the clear-to-null test on `expected 'high' to be '__none__'`; badge *text* ("No priority", not "High") is asserted, not just the bound value. |
| AS-008 | PASS (was fragile) | Throw test now starts at `high`, moves to `low`, asserts `low` while pending, then the revert. Deleting the `try/catch` fails on `expected 'low' to be 'high'`. |
| AS-009 | PASS | Forcing the `isSavingTitle` spinner off fails the indicator test; appear/disappear both asserted around a manually-resolved promise. |
| AS-010 | PASS (was **blocker**) | F016 added the `try/catch`. Deleting `setTitle(previousTitle)` from the else-branch and the catch fails **two** tests (`expected 'Broken edit' to be 'Original title'`). Non-vacuous: `handleTitleBlur` applies `setTitle` synchronously, so the DOM genuinely reads `Broken edit` when the revert assertion starts. |
| AS-011 | PASS | Enter delegates to `handleTitleBlur`; removing `currentTarget.blur()` fails the test. No dialog exists on the commit path. |
| AS-012 | **FAIL (major)** | Optimistic flip itself is solid (removing `setOptimisticIsDone` fails 7 of 8 tests), but F019's fix does not make it durable. `clearPending()` runs in the same tick as `setTodos`, after which the render-phase sync takes the unconditional `setTodos(initialTodos)` branch — a refresh issued pre-write but resolving post-commit reverts the checked row to unchecked with no toast. Reproduced. Reachable via `handleCreate`'s `router.refresh()` (`:95`), realtime, or navigation. Both tests named for this scenario pass with the guard deleted. |
| AS-013 | PASS | Three independent mutants killed: toast removed from `!result.ok`, toast removed from `catch`, revert replaced by a commit. (The throw-path test's revert half is vacuous — see Systemic 2 — but the `{ok:false}` test carries it.) |
| AS-014 | **FAIL (major)** | Symmetric to AS-012 by construction — same `clearPending`/render-sync path. The immediate-uncheck behaviour is covered by the `DONE_TODOS` test; the *survival* of that state is not, and its named test is vacuous. |

Totals: 11 PASS / 3 FAIL (0 blockers, 3 major). Previously 13 PASS / 1 FAIL.

## Systemic findings

### 1. F019's fix does not reach the bug, and its tests do not reach the fix (major)
Pass 2's Systemic Finding 2 described a stale sync landing **after** a commit. F019's guard
(`components/my-tasks/personal-todo-list.tsx:38-59`) branches on `pendingToggleIds.size === 0`,
and `clearPending()` (`:151`) runs immediately after `setTodos` (`:148`) in the same
transition — so the protected window closes exactly when protection starts mattering. There
is no version, timestamp, or committed-since bookkeeping.

Deleting the whole guard (reverting `:38-59` to the unconditional `setTodos(initialTodos)`)
leaves **7 of 8 tests passing**. Only `test_AS_012_AS_014_in_flight_row_is_not_clobbered_by_a_stale_sync_mid_toggle`
fails, and it asserts on a `title` field that no assertion in the contract mentions — it tests
the merge *mechanism* the fix happens to use, not the behaviour AS-012/AS-014 state. The two
tests actually named `..._survives_a_server_data_refresh_...` are vacuous, because
`useOptimistic`'s pending flip masks the boolean during the in-flight window regardless. The
commit's own comment concedes this; the response was to work around the un-observability
rather than to make the behaviour observable.

### 2. Vacuous revert assertions persist in three suites (major — this is the third report to raise it)
Confirmed by mutation, not inspection. Replacing `useOptimistic` with `useState` in the shared
hook removes auto-revert entirely, yet these still pass:
- `tests/unit/list-priority-select-optimistic.test.tsx:127` — starts `medium`, asserts `medium`
- `tests/unit/list-due-date-cell-optimistic.test.tsx:107` — starts `2026-09-01`, asserts `2026-09-01`
- `tests/unit/list-due-date-cell-optimistic.test.tsx` clear-to-null test — same shape
- `tests/unit/use-optimistic-action.test.tsx:105` — starts `old`, asserts `old`
- `tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx:103` — starts unchecked, asserts unchecked (the sole survivor when `setOptimisticIsDone` was removed)

F017 fixed exactly this shape in f003/f004 by asserting the optimistic value first. That
correction was not propagated to the list cells, the hook's own test, or f006, even though
FU-G named all of them. Note the f003/f004 in-test comments now misdescribe *why* those tests
are sound: the revert target still equals the base prop (unavoidable with `useOptimistic`);
what makes them sound is the intervening `waitFor` on the optimistic value.

### 3. `pendingToggleIds` can leak permanently, freezing a row out of all server syncs (major)
On a stale response (`latestToggleRef.current.get(todo.id) !== requestId`, `:136` and `:153`)
the handler returns *without* clearing pending, deliberately deferring to the newer request. If
that newer promise never settles — unmount, hung fetch, aborted navigation — the id stays in
`pendingToggleIds` for the component's lifetime. There is no unmount cleanup and no timeout.
While an id is pending, the `unchanged` short-circuit (`:53-57`) also stops syncing that row's
*non-toggle* fields (title, position, server-side deletion) — broader than the stated fix scope.
Additionally, `merged` maps over `initialTodos`, so a pending row deleted server-side is dropped
despite being "protected". Untested.

### 4. Post-success snap-back on the detail sheet is invisible to the test suite (major, outside assertion scope)
On `result.ok`, `optimisticStatus`/`optimisticPriority` unwind to the base `task.*` prop once the
transition settles, and neither `handleStatusChange` nor `handlePriorityChange` calls
`router.refresh()` or any `onTaskUpdated`. If the parent's realtime/refetch has not landed the
new prop, the badge visibly snaps back after a *successful* save. Both f003 and f004 resolve
`{ok:true}` only as cleanup and then `await waitFor(() => {})` with no post-success assertion, so
this entire class of bug is un-observable to the suite. This is the third report to note it.

### 5. Minor
- `lib/hooks/use-optimistic-action.ts:46` still uses a bare `catch {`, discarding the error object
  with no `console.error`. A network loss, a 500, and a serialization bug are indistinguishable in
  production logs. The repo has a `create-notification-error-observability` test, so a convention exists.
- `task-detail-sheet.tsx:987` and `:1023` discard the server's own `result.error` for status and
  priority (unlike `saveField` and `handleTitleBlur`, which surface it). A reason like "task is
  blocked" becomes the generic "Failed to set status to X". Satisfies AS-006/AS-008 as written; worth
  confirming against the clarified spec.
- Client-side title rejections (empty, >500 chars, `:759-769`) `setTitle(task.title)` + toast with no
  test. Arguably in AS-010's scope ("if the title save fails"); they also revert to the prop rather
  than the captured `previousTitle`.
- `task-detail-sheet.tsx:782`'s comment claims capturing `previousTitle` before the transition makes
  the revert "independent of whatever `task.title` prop value the caller may have moved on to" — but it
  captures *from* that prop and so inherits exactly the staleness it claims to avoid. The comment is
  more wrong than the code.
- Re-entrancy: `:965`/`:1011` drop a rapid repeat of the *same* target but start a second concurrent
  transition for a *different* target with no ordering guarantee. Untested; last-write-wins is not
  guaranteed on the detail sheet (unlike the to-do list, which has `latestToggleRef`).
- `confirmIfMovingToDone` (`:967`) is never exercised — `getOpenBlockers` is mocked to `[]` in both suites.
- AS-011's "without a separate dialog" is asserted only structurally: the test proves `editTask` was
  called, never that no dialog rendered. Adequate today (no dialog exists), but it would not catch a
  regression that added one alongside a working inline save.
- Pass-2 minors still open: `intendedIsDone`'s overclaiming comment (`:76-81` — the `requestId` guard
  is the load-bearing part); `latestToggleRef` never pruned in `handleDelete`; f003/f004/f005 mock
  `getMentionCandidates` as `{ok:true,data:[]}` while the component reads `result.data.userIds`; the
  title edit is lost if the Sheet unmounts mid-edit; FU-E (converge on the shared hook) never scheduled.

## Recommended follow-up features

**FU-J — Make the personal to-do list's committed state durable against stale server payloads (major, AS-012/AS-014).**
`clearPending()` closes F019's protection window at the exact moment the post-commit hole opens. Replace
the boolean `pendingToggleIds` set in `components/my-tasks/personal-todo-list.tsx` with per-row
bookkeeping that survives the commit — e.g. record for each id the local commit's monotonic sequence
number (or a `committedAt` timestamp) and, in the render-phase sync at `:38-59`, keep the local value
for any row whose local commit is newer than the fetch that produced `initialTodos`, clearing the entry
only once a server payload actually reflects the committed value. Whatever the mechanism, it must be
*observable*: add a test that checks a to-do, resolves the toggle `{ok:true}`, THEN re-renders with a
stale `initialTodos` (new array identity, `isDone:false`) and asserts the checkbox is still checked —
this is the scenario F019 claimed to fix and did not. Also handle the leak in Systemic 3: clear the
pending/version entry on unmount and when a row disappears from the server payload, and stop the
`unchanged` short-circuit from freezing an in-flight row's unrelated fields. While there, replace the
two vacuous `..._survives_a_server_data_refresh_...` tests — both pass with the entire guard deleted —
with ones that fail when it is removed. Assertions touched: AS-012, AS-014.

**FU-K — Make every remaining revert assertion discriminating (major, AS-004).**
F017 applied the correct three-phase shape (deferred mock → assert the optimistic value while pending →
settle → assert the revert) to f003 and f004 but not to the files FU-G also named. Apply it to:
`tests/unit/list-due-date-cell-optimistic.test.tsx` (both the throw test at `:107` and the clear-to-null
`{ok:false}` test — AS-004 currently has *no* discriminating revert coverage at all),
`tests/unit/list-priority-select-optimistic.test.tsx:127` (the throw test; the `{ok:false}` test F017
added is already correct and can serve as the template), `tests/unit/use-optimistic-action.test.tsx:105`,
and `tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx:103`. The acceptance criterion is mechanical
and must be verified by the implementer: swapping `useOptimistic` for `useState` in
`lib/hooks/use-optimistic-action.ts` (and the equivalent in `personal-todo-list.tsx`) must fail *every*
one of these tests; today it fails none of them. Also split the due-date `{ok:false}` coverage out of the
clear-to-null test so refactoring one does not silently delete the other. Assertions touched: AS-004,
AS-013.

**FU-L — Cover and correct the post-success settle path on the detail sheet (major).**
Three consecutive reports have flagged that a *successful* status or priority change unwinds
`optimisticStatus`/`optimisticPriority` back to the stale `task.*` prop, with no `router.refresh()` or
`onTaskUpdated` call to reconcile — so the badge can visibly snap back after a save that worked, and no
test can see it because both suites resolve `{ok:true}` purely as cleanup. Decide the reconciliation
contract explicitly (call the caller's update callback, refresh, or hold the optimistic value until a
matching prop arrives) and add success-path tests that resolve `{ok:true}`, re-render with the updated
prop, and assert the new value HOLDS — plus one that resolves `{ok:true}` *without* a prop update and
asserts the intended behaviour rather than stepping around it. While there, address the smaller items in
Systemic 5: give `lib/hooks/use-optimistic-action.ts:46` a bound `catch (error)` with a `console.error`,
surface the server's `result.error` for status/priority or document why it is deliberately dropped, add
tests for the client-side title rejections at `task-detail-sheet.tsx:759-769`, and fix the three
misleading comments (`:782` `previousTitle`, `personal-todo-list.tsx:76-81` `intendedIsDone`, and the
f003/f004 "starting and asserting at the same value" rationale, which describes a mechanism that is not
the one making those tests sound). Assertions touched: AS-005, AS-006, AS-007, AS-008.

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
   Start at  07:59:58
   Duration  33.80s (transform 2.95s, setup 0ms, import 68.00s, tests 28.34s, environment 21.13s)
```

Net test delta versus pass 2: 1413 → 1418 (+5). Six new `it(...)` blocks (one in f005, one in
list-priority-select, three in f006) and one rewritten in place; three of the six do not fail when the
code they name is deleted.

Working tree verified clean of code changes at exit (`git status` shows only pre-existing
`supabase/.temp/*` churn and untracked mission files).

Note: `tests/integration/**` was again not run, for the same reason as both prior reviews — every M1
handoff attributes 50–90 failures there to live-Supabase rate limits. That claim remains unverified and
the integration suite is still not a gate this milestone can pass or fail on.
