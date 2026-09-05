# M1 Re-Scrutiny — Optimistic UI hardening (after F013, F014, F015)

Mission: 20260830-223927
Reviewed commits: edb6c70 (F013), e7506dc (F014), ec6afb3 (F015), on top of e62faef..5440fbe
Reviewer: scrutiny validator (read-only; no repo files modified)
Prior report: `M1-scrutiny.md` (8 PASS / 6 FAIL)

## Verdict: **FAIL**

Five of the six previously-failing assertions are genuinely fixed and the fixes are
backed by discriminating tests. The milestone still fails on one blocker: **AS-010**.

FU-A explicitly named `handleTitleBlur` as one of the four `task-detail-sheet.tsx`
awaits needing a `try/catch`. F013 wrapped `saveField`, `handleStatusChange`, and
`handlePriorityChange` but **skipped the title path**. `components/task/task-detail-sheet.tsx:783-791`
still reads:

```js
    const previousTitle = task.title;
    startTitleSaveTransition(async () => {
      const result = await editTask(task.id, { title: trimmed });
      if (result.ok) {
        toast.success("Title updated.");
      } else {
        setTitle(previousTitle);
        toast.error(result.error);
      }
    });
```

On a thrown rejection neither branch runs: no `setTitle(previousTitle)` revert and no
`toast.error`. The discarded edit stays on screen and the user is told nothing —
exactly what AS-010 forbids. Reproduced empirically in a scratch probe: the rejection
surfaces as an unhandled error while the existing tests still pass green. There is no
throw-path test in `tests/unit/f005-task-detail-sheet-title-optimistic.test.tsx` at all,
so nothing in the suite would have caught this.

`tsc` is clean, lint is 0 errors / 13 pre-existing warnings, and 1413 unit tests pass —
the gate fails on correctness, not on tooling.

## Assertion results

| ID | Result | Reason |
|---|---|---|
| AS-001 | PASS | Optimistic value applied synchronously inside the hook's transition before the await; test uses a never-resolving mock so the new label can only come from the optimistic path. |
| AS-002 | PASS (was FAIL) | Hook now has `try/catch`; the test mock is a real `mockRejectedValue(new Error("network"))`. Mutation-verified: deleting the `try/catch` makes this test fail. |
| AS-003 | PASS | Commits on `onChange` inside the transition; never-resolving mock drives the real component. |
| AS-004 | PASS (was FAIL) | Same real rejection mock; removing the `try/catch` fails it. A separate test still covers the `{ok:false}` clear-to-null path. |
| AS-005 | PASS | `setOptimisticStatus(next)` precedes `await moveTaskStatus`; Select bound to `optimisticStatus ?? task.status`, safe since status is never null. |
| AS-006 | PASS (was FAIL) — **major fragility** | `try/catch` added and the throw mock genuinely rejects. But `test_AS_006_..._when_server_action_throws` starts at `todo`, selects `in_progress`, then asserts `value === "todo"` — `waitFor` succeeds on the first tick, so the revert half is vacuous. Only the toast assertion carries weight. The separate `{ok:false}` test IS discriminating. |
| AS-007 | PASS (was **blocker**) | Null-collapse genuinely fixed. `useOptimistic` baseline is now a literal `undefined` typed `priority \| undefined`; both read sites (the dedupe guard at :1007 and the Select value at :1464) use `!== undefined`. Grep confirms no residual `??` on the override — the trailing `?? NO_PRIORITY_VALUE` at :1466 is applied *after* the override resolves, correctly mapping a real `null` to `"__none__"`. The new `high → No priority` test is discriminating: it fails against the old `??` code. |
| AS-008 | PASS (was FAIL) — **major fragility** | `try/catch` added; `{ok:false}` revert test is genuine. Two gaps: the throw test has the same vacuous-`waitFor` shape as AS-006 (starts at `__none__`, asserts `__none__`), and FU-B's requested **failed clear-to-null** test (high → No priority → reject → back to High) was never added. The code is correct there by inspection, but unverified. |
| AS-009 | PASS | Dedicated `isSavingTitle` transition drives a real `Loader2` plus an sr-only `role="status"`; test observes appear/disappear around a manually-resolved promise. |
| AS-010 | **FAIL (blocker)** | `handleTitleBlur` has no `try/catch`. A thrown `editTask` produces no revert and no toast, and no test in f005 supplies a rejecting mock. F013 fixed the other three awaits in this same file and missed this one. |
| AS-011 | PASS | Enter blurs to reuse the single `handleTitleBlur` commit path; no dialog; Escape's `isCancellingTitleEditRef` guard correctly suppresses the save. |
| AS-012 | PASS — **major caveat** | Optimistic flip precedes the await; test asserts `aria-checked="true"` + `line-through` while pending. Caveat: the render-phase reset at :28-31 is still unguarded (see Systemic 2). |
| AS-013 | PASS (was FAIL) | `try/catch` added to `handleToggle` with the same `toast.error("Failed to update task")`; test uses a real `Promise.reject`. The success path commits via `setTodos`, so the revert assertion here IS discriminating. |
| AS-014 | PASS | Distinct `DONE_TODOS` test asserting pre-state, immediate optimistic uncheck, and the `{isDone:false}` payload. |

Totals: 13 PASS / 1 FAIL (1 blocker, 0 major-as-failure). Previously 8 PASS / 6 FAIL.

## Systemic findings

### 1. Vacuous revert assertions in both new detail-sheet throw tests (major, AS-006/AS-008)
Any revert assertion whose expected value equals the component's *starting* value proves
nothing — `waitFor` is satisfied on the first tick, before the optimistic render even
lands. Both F013 detail-sheet throw tests have this shape. Independently confirmed for
the list cells too: rewriting the AS-002 mock to `async () => ({ ok: true })` and dropping
the toast assertion still passes. Across the whole milestone, the only thing distinguishing
"correctly reverted after failure" from "wrongly discarded a successful change" is the
toast assertion. This is the unaddressed remainder of prior Systemic Finding 2 (FU-C was
never scheduled).

### 2. `personal-todo-list.tsx` render-phase reset still clobbers committed state (major)
F015 fixed the out-of-order *commit* but not the prop-resync half of prior FU-D.
`:28-31` (`if (initialTodos !== syncedInitial) setTodos(initialTodos)`) is identity-based,
and `router.refresh()` always yields a fresh array identity. Reproduced: a refresh landing
*mid*-toggle is benign (the pending optimistic flip replays over the new base), but a
refresh landing *after* the commit whose payload predates the toggle's DB write silently
reverts the checkbox to unchecked **with no toast**. Reachable path: check a to-do, then
immediately add a new one → `handleCreate` → `router.refresh()`. Narrow (the action does
`revalidatePath`), but the reset unconditionally trusts the prop over local commits.

### 3. Client-side ordering does not fix server-side ordering (major, outside assertion scope)
The `latestToggleRef` guard orders *client commits* only. If request 1 (`isDone:true`)
reaches the database *after* request 2 (`isDone:false`), the DB ends `true` while the client
shows `false`, and `handleToggle` never calls `router.refresh()` — the divergence persists
until the next navigation. Not covered by AS-012/013/014.

### 4. The `intendedIsDone` const in F015 is cosmetic; its comment overclaims (minor)
Mutation-tested: reverting `intendedIsDone` to `!todo.isDone` recomputed after the await
leaves all five tests green, because `todo` is a captured closure *parameter* and cannot go
stale. The comment at :76-81 claims it guards against "a possibly stale closure". The only
thing actually fixing out-of-order commits is the `requestId` guard (deleting that guard
DOES fail the rapid-toggle test — that part is load-bearing and genuinely covered). The
misleading comment invites a future "simplification" that looks unsafe and is in fact safe,
or vice versa.

### 5. Coverage regression: the `{ok:false}` list-priority path lost its only test (major)
F013 **replaced** rather than added. `tests/unit/list-priority-select-optimistic.test.tsx`
now has exactly two tests and neither exercises an `{ok:false}` return — the hook's
`if (result && "error" in result) toast.error(result.error || errorMessage)` branch is
untested for the priority cell. `{ok:false}` (validation/permission denial) is a more common
production failure than a thrown rejection. `list-due-date-cell-optimistic.test.tsx` kept a
`{ok:false}` case at :115, so only the priority cell regressed.

### 6. The shared hook's own `catch` has no direct test (minor)
`tests/unit/use-optimistic-action.test.tsx:89` is named
`test_AS_failure_hook_reverts_and_calls_toast_on_action_rejection...` but its mock is
`vi.fn(async () => ({ error: "" }))` — it resolves, never rejects. That file passes unchanged
with the hook's `try/catch` deleted. The catch survives only transitively via the two
component tests; a refactor of either would silently orphan it. This is the same
name-asserts-coverage-that-does-not-exist problem the prior report flagged, relocated rather
than removed.

### 7. Minor
- `lib/hooks/use-optimistic-action.ts:46` uses a bare `catch {` that discards the error
  object entirely. Network and serialization failures are undiagnosable in production.
- All three detail-sheet suites still `vi.mock("@/components/ui/select")` down to a native
  `<select>` and stub `SelectValue: () => null`. The label render-props (:1443-1448,
  :1475-1483) — including the `NO_PRIORITY_VALUE → "No priority"` mapping that F014 exists
  to make correct — have zero coverage. The "badge" AS-005/AS-007 literally name is still
  unverified at the unit level and must be covered by the UX validator. (Prior Systemic
  Finding 3, unaddressed.)
- A successful clear-to-null does not hold: `optimisticPriority` returns to `undefined` on
  settle and display falls back to `task.priority`, and neither `handlePriorityChange` nor
  `handleStatusChange` calls `router.refresh()` or any `onTaskUpdated`. Reconciliation depends
  entirely on the caller's realtime/refetch path. The F014 test resolves `{ok:true}` then does
  `await waitFor(() => {})` with no post-success assertion — the snap-back is stepped around,
  not verified. Correct per the feature's clarified answer, but a real UX risk if realtime lags.
- `latestToggleRef` is never pruned (`handleDelete` does not remove entries), and
  `useRef(new Map())` allocates and discards a fresh `Map` on every render. Harmless —
  bounded by distinct ids per mount, and ids are uuids or `temp-${Date.now()}` so no reuse.
- Prior minors that remain open: f003/f004/f005 fixtures mock `getMentionCandidates` as
  `{ok:true,data:[]}` while the component reads `result.data.userIds`; the title edit is lost
  if the Sheet unmounts while the input is still focused; FU-E (converge on the shared hook)
  was not scheduled, so the milestone still ships three optimistic idioms across four files.

## Recommended follow-up features

**FU-F — Add the missing `try/catch` to `handleTitleBlur` (blocker).**
In `components/task/task-detail-sheet.tsx`, wrap the `await editTask(task.id, { title: trimmed })`
inside `startTitleSaveTransition` (~:783-791) in a `try/catch`, mirroring the shape F013 already
applied to `handlePriorityChange` and `handleStatusChange` in the same file. Unlike `saveField`,
this path owns a local mirror (`title` state), so the catch block must do **both** things the
`{ok:false}` branch does: `setTitle(previousTitle)` **and** `toast.error(...)`. Reuse the existing
captured `previousTitle` const so a rejection reverts to the true pre-edit value rather than to a
possibly-moved-on `task.title` prop. Add a test in
`tests/unit/f005-task-detail-sheet-title-optimistic.test.tsx` using a mock that genuinely REJECTS
(`Promise.reject(new Error("network"))`, not `{ok:false}`), asserting the input's displayed value
returns to the pre-edit title AND that `toast.error` was called. Start the test from a non-default
title and assert the edited value is visible before the rejection lands, so the revert assertion is
not vacuous. Assertions touched: AS-010.

**FU-G — Make every optimistic failure test discriminating (major).**
The revert assertions across this milestone are satisfiable at t=0 because they assert the value
equals the starting value. For each failure test in `f003`, `f004`, `list-priority-select-optimistic`,
`list-due-date-cell-optimistic`, and the new f005 throw test from FU-F, restructure to a three-phase
shape: (1) deferred-resolution mock, (2) assert the OPTIMISTIC value is rendered while the promise
is pending, (3) reject/resolve-false and assert the revert. Additionally add the paired SUCCESS test
FU-C described — re-render with the updated prop after resolution and assert the new value HOLDS —
so the failure tests can no longer be satisfied by React's outcome-independent unwind. Also restore
an `{ok:false}` test to `list-priority-select-optimistic.test.tsx` (F013 replaced it with the throw
case, leaving that branch uncovered), add a `mockRejectedValue` case directly to
`tests/unit/use-optimistic-action.test.tsx` so the hook's own `catch` is covered rather than only
transitively, and either rename or fix that file's misnamed `..._on_action_rejection` test whose mock
resolves. Assertions touched: AS-002, AS-004, AS-006, AS-008.

**FU-H — Cover the failed clear-to-null priority path (major).**
FU-B asked for two tests and only one was delivered. Add the inverse of
`test_AS_007_clearing_priority_to_null_updates_immediately...`: start from `priority: "high"`, select
`No priority`, assert `__none__` while pending, then reject the action and assert the Select returns
to `high` with `toast.error("Failed to set priority to No priority")`. This is the one case where the
new `undefined`-baseline semantics could have been botched and it is currently unverified by any test.
While there, stop stubbing `SelectValue` to `() => null` in `f003`/`f004` so the badge label
render-prop — including the `NO_PRIORITY_VALUE → "No priority"` mapping F014 exists to make correct —
is actually rendered and asserted as TEXT, not just as a bound value. Assertions touched: AS-007, AS-008.

**FU-I — Finish the `personal-todo-list` concurrency hardening (major).**
F015 delivered the commit-ordering half of FU-D but not the prop-resync half. Guard the render-phase
reset at `:28-31` so an `initialTodos` identity change cannot overwrite a locally-committed toggle with
a stale server payload — e.g. skip or merge the reset while any toggle is in flight or was committed more
recently than the fetch, or version the reset on a token bumped by each commit. Add a test for a prop
refresh carrying pre-toggle data landing after a successful commit, asserting the checkbox stays checked.
Separately, decide how server-side divergence is reconciled when request 1 reaches the DB after request 2:
either serialize per-todo requests client-side, or call `router.refresh()` after the final settled toggle.
Also correct the overclaiming comment at `:76-81` (mutation testing shows `intendedIsDone` is cosmetic —
the `requestId` guard is the load-bearing fix) and prune `latestToggleRef` entries in `handleDelete`.
Assertions touched: AS-012, AS-013.

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
  86:4   warning  '_taskId' is defined but never used   @typescript-eslint/no-unused-vars
  86:21  warning  '_updates' is defined but never used  @typescript-eslint/no-unused-vars

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
      Tests  1413 passed (1413)
   Start at  01:49:25
   Duration  32.37s (transform 2.65s, setup 0ms, import 62.23s, tests 31.59s, environment 19.02s)
```

Net test delta versus the prior review: 1408 → 1413 (+5). Six new `it(...)` blocks were added
and one existing test was rewritten in place rather than supplemented (see Systemic Finding 5).

Note: `tests/integration/**` was again not run, for the same reason as the prior review — every
M1 handoff attributes 50–90 failures there to live-Supabase rate limits. That claim remains
unverified by this review, and the integration suite's health is still not a gate this milestone
can pass or fail on.
