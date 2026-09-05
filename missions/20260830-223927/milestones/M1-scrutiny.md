# M1 Scrutiny — Optimistic UI hardening (F001–F007)

Mission: 20260830-223927
Reviewed commits: e62faef, bb4bd3e, 74a3dbc, fb1cff2, db1e191, 8ed6770, 5440fbe
Reviewer: scrutiny validator (read-only; no files modified)

## Verdict: **FAIL**

Gate criterion from `plan.md` is "All optimistic cells/sheet revert on error; `tsc` clean; tests pass."
`tsc`, lint, and the unit suite are all clean. The gate fails on correctness:
one assertion (AS-007) is not met for a reachable input, and the error path is
only handled for one of the two ways a Server Action can fail.

## Assertion results

| ID | Result | Reason |
|---|---|---|
| AS-001 | PASS | `list-priority-select.tsx` applies the optimistic value synchronously inside the hook's transition before `await editTask`; test asserts DOM value flips while the action promise is still unresolved. |
| AS-002 | FAIL (major) | Revert + toast work for `{ok:false}` and that test IS mutation-sensitive. But `useOptimisticAction` has no `try/catch`: verified empirically that a THROWING `editTask` leaves the cell on the new value with **no revert and no toast** (unhandled rejection). |
| AS-003 | PASS | `list-due-date-cell.tsx` commits on `onChange` inside the transition; test asserts the input value before the action resolves. |
| AS-004 | FAIL (major) | Same missing `try/catch` in the shared hook; empirically reproduced against the real `ListDueDateCell` — no revert, no toast. The `{ok:false}` half, including clear-to-null, is well covered. |
| AS-005 | PASS | `setOptimisticStatus(next)` precedes `await moveTaskStatus`; Select bound to `optimisticStatus ?? task.status`; status is never null so the `??` is safe here. |
| AS-006 | FAIL (major) | Toast is correct for `{ok:false}`; no `try/catch` for a rejected action. The revert half of the assertion is not verified by any test that could fail (Systemic Finding 2). |
| AS-007 | **FAIL (blocker)** | `task-detail-sheet.tsx:1434` renders `(optimisticPriority ?? task.priority) ?? NO_PRIORITY_VALUE`. Clearing a priority sets the optimistic value to `null`, which `??` collapses back to the base prop — the badge keeps showing the OLD priority with no optimistic update. The early-return guard at :986 has the same conflation. No test covers `high → null`, so the bug is invisible. |
| AS-008 | FAIL (major) | Inherits the AS-007 null-collapse (a failed clear "reverts" to a value it never visually left) plus the missing `try/catch`. |
| AS-009 | PASS | Dedicated `isSavingTitle` transition drives a real `Loader2` (`data-testid="title-saving-indicator"`) and an sr-only `role="status"`; test asserts presence in flight and absence after resolve. Discriminating. |
| AS-010 | PASS | Title uses `useState` with an explicitly captured `previousTitle` and a real `setTitle(previousTitle)` on failure (`task-detail-sheet.tsx:770-777`) — deleting that line fails the test. Correct and genuinely verified. |
| AS-011 | PASS | Enter → `preventDefault` + `blur()` reusing `handleTitleBlur`; no dialog exists in the path; Enter-commit and Escape-cancel both tested. |
| AS-012 | PASS | `personal-todo-list.tsx` renders checkbox and strikethrough from `optimisticTodos`; test asserts `aria-checked="true"` + `line-through` while the action promise is pending. |
| AS-013 | FAIL (major) | Revert + toast are correct and genuinely tested for `{ok:false}` (success commits via `setTodos`, so the revert assertion IS discriminating here). But `handleToggle` has no `try/catch`: a thrown `toggleTodo` silently reverts the checkbox with no toast — precisely what AS-013 forbids. |
| AS-014 | PASS | Distinct test with a `DONE_TODOS` fixture asserting pre-state, optimistic uncheck before resolution, and the `{isDone:false}` payload. Not assumed symmetric. |

Totals: 8 PASS / 6 FAIL (1 blocker, 5 major).

## Systemic findings

### 1. No Server Action rejection is handled anywhere (blocker-adjacent, affects AS-002/004/006/008/010/013)
Every awaited Server Action in this milestone is unguarded:
- `lib/hooks/use-optimistic-action.ts:37` — `const result = await action(newValue);`
- `components/task/task-detail-sheet.tsx:717` (`saveField`), `:960` (status), `:990` (priority), `:772` (title)
- `components/my-tasks/personal-todo-list.tsx:72` (`handleToggle`)

A Next.js Server Action rejects (rather than returning `{ok:false}`) on network loss,
a 500, or a serialization error — the most common real-world failure. In every one of
those cases the user gets **no error toast**, and for the title the discarded edit
stays on screen with no revert. Not one test in the milestone supplies a rejecting
mock. Note that `tests/unit/list-priority-select-optimistic.test.tsx` names its test
`..._when_server_action_throws` while the mock actually resolves to `{ok:false}` —
the name asserts coverage that does not exist.

### 2. Revert assertions do not distinguish success from failure (major)
Mutation testing confirms the list-cell revert assertions are NOT vacuous — a
deliberately non-reverting variant of `ListDueDateCell` does fail
`waitFor(value === prior)`. So these tests would catch a broken revert.
What they do not catch is the inverse: for `list-priority-select`,
`list-due-date-cell`, and both detail-sheet Selects, `useOptimistic` unwinds to the
base prop when the transition settles **regardless of outcome**, and none of those
components commit on success. The identical assertion therefore also passes when the
action SUCCEEDS, which means the tests cannot tell "correctly reverted after failure"
from "wrongly discarded a successful change". In production this is masked only by
`editTask`'s `revalidatePath` pushing a fresh prop down; if that revalidation is ever
narrowed or the component is reused outside a revalidated route, a successful edit
visibly snaps back to the old value with no test failing.
The discriminating shape is a paired test: on SUCCESS, re-render with the updated prop
and assert the new value HOLDS; on FAILURE, assert it reverts.
`personal-todo-list.tsx` already has this property (success calls `setTodos`), which
is why AS-012/013/014's tests are the strongest in the milestone.

### 3. Real Select primitive is never exercised (major, AS-001/005/007)
F001, F003, and F004 all `vi.mock("@/components/ui/select")` down to a bare native
`<select>`. F003's mock further stubs `SelectValue` to `() => null`, so the badge
label render-prop at `task-detail-sheet.tsx:1414-1419` — the thing AS-005/AS-007
literally assert ("the status/priority *badge* updates") — is never rendered in any
test. The jsdom limitation is real and documented, but the consequence is that "badge
updates" is unverified at the unit level and must be covered by the UX validator.

### 4. `personal-todo-list.tsx` success commit uses an absolute, closure-captured value (major)
`:83-85` writes `isDone: !todo.isDone` from the click-time closure while the optimistic
reducer (`:43`) flips relatively. Two rapid toggles of the same row resolving out of
order leave committed state at whichever response lands last, not last user intent.
Additionally `:28-31` resets `todos` from `initialTodos` during render, so a
`router.refresh()` (e.g. from `handleCreate`) landing mid-toggle can visibly flash an
in-flight checkbox back to its pre-toggle state. Neither is tested. The Selects avoid
the rapid-toggle class of bug only because they are `disabled` while pending.

### 5. Minor
- `use-optimistic-action.test.tsx:101-105` clicks and immediately waits for `"old"`
  without first asserting the value became `"new"` — that test would pass against a
  hook that never applies the optimistic value at all. The component-level tests are
  what actually cover AS-001/AS-003.
- `use-optimistic-action.ts` narrows `action`'s return to `void | {error}`, so callers
  must translate `{ok,error}` themselves; both retrofitted cells discard the server's
  real `result.error` in favour of a fixed string, meaning a specific server reason
  (e.g. "You must be signed in") is never surfaced to the user. Same in `handleToggle`.
- F007 left F003/F004/F006 un-retrofitted, so the milestone ships three different
  optimistic idioms in four files; the AS-007 null bug exists only in the hand-rolled
  copy and would have been avoided by the hook (whose `optimisticValue` is returned
  directly, not `??`-defaulted).
- Test fixtures in f003/f004/f005 mock `getMentionCandidates` as `{ok:true,data:[]}`
  while the component reads `result.data.userIds` (`:876`); this only survives because
  `members` is empty. Latent breakage.
- Title edit is lost if the Sheet unmounts or the task prop switches while the input
  is still focused (commit depends on a `blur` event firing). Untested.

## Recommended follow-up features

**FU-A — Handle rejected Server Actions across all optimistic paths (blocker).**
Wrap every awaited Server Action in this milestone in `try/catch`: the `await action()`
inside `lib/hooks/use-optimistic-action.ts`, all four awaits in
`components/task/task-detail-sheet.tsx` (`saveField`, `handleStatusChange`,
`handlePriorityChange`, `handleTitleBlur`), and `handleToggle` in
`components/my-tasks/personal-todo-list.tsx`. On catch, emit the same `toast.error`
the `{ok:false}` branch emits, and for the title also run the existing
`setTitle(previousTitle)` revert. Add one test per surface using a mock that REJECTS
(not one that resolves to `{ok:false}`), asserting both the visible revert and the
toast. Rename `test_AS_002_..._when_server_action_throws` to match what it actually
does, or make it actually throw. Assertions touched: AS-002, AS-004, AS-006, AS-008,
AS-010, AS-013.

**FU-B — Fix the priority null-collapse in the task detail sheet (blocker).**
In `components/task/task-detail-sheet.tsx`, `optimisticPriority` is a legitimately
nullable value, so `optimisticPriority ?? task.priority` at `:1434` and in the guard at
`:986` silently discards the "cleared" optimistic state. Seed the `useOptimistic` call
so the optimistic value is always authoritative (or hold a `{value}` wrapper /
`NO_PRIORITY_VALUE` sentinel rather than raw `null`) and read it directly without a
`??` fallback — the pattern `list-priority-select.tsx` already uses correctly. Add a
test covering `high → "No priority"` asserting the Select shows `No priority` before
the action resolves, and a matching failure test asserting it returns to `High`.
Assertions touched: AS-007, AS-008.

Note for FU-A/FU-B sequencing: FU-A's `try/catch` belongs in
`lib/hooks/use-optimistic-action.ts` for the list cells but must be added separately
in `task-detail-sheet.tsx` and `personal-todo-list.tsx`, which do not use the hook.
FU-E would collapse that to one site and should be considered before FU-A if both are
scheduled together.

**FU-C — Make optimistic revert tests discriminating (major).**
For each of the four `useOptimistic`-only surfaces, add a paired success test that
re-renders the component with the updated prop after the action resolves and asserts
the NEW value persists, so the existing failure tests can no longer be satisfied by
React's outcome-independent unwind. Where feasible, also assert the rendered badge
text (not just the bound `value`) so the `SelectValue` render-prop is exercised; if
jsdom truly cannot drive the Base UI combobox, stop stubbing `SelectValue` to `null`
and at minimum render the real label function. Assertions touched: AS-002, AS-004,
AS-005, AS-006, AS-007, AS-008.

**FU-D — Harden `personal-todo-list.tsx` toggle against concurrency (major).**
Make the success commit relative (`isDone: !t.isDone`) or derive it from the server
response rather than from the click-time closure, and prevent an `initialTodos`
re-sync from clobbering an in-flight optimistic toggle (e.g. skip the render-phase
reset while a toggle transition is pending, or key the reset on a version token).
Add tests for two rapid toggles of the same row resolving out of order, and for a
prop refresh landing mid-flight. Assertions touched: AS-012, AS-013, AS-014.

**FU-E — Converge on the shared hook (minor).**
Widen `useOptimisticAction` to accept `errorMessage: string | ((value: T) => string)`
and an optional async pre-flight guard, then retrofit `handleStatusChange`,
`handlePriorityChange`, and `handleToggle` onto it, so there is one optimistic idiom
and one place where the `try/catch` from FU-A lives. Preserve the per-value toast
copy ("Failed to set status to Done") and the `confirmIfMovingToDone` ordering.
Also decide deliberately whether `result.error` or the fixed copy is shown, and apply
that choice uniformly.

## Command output

### `npx tsc --noEmit`
```
(no output — exit 0)
```

### `npm run lint`
```
0 errors, 13 warnings (all pre-existing-style unused-arg / unused-import warnings)

components/chat/message-list.tsx
   22:26  warning  'SmilePlus' is defined but never used
  161:5   warning  Unused eslint-disable directive

tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx
  98:4   warning  '_taskId' is defined but never used
  98:21  warning  '_status' is defined but never used

tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx
  86:4   warning  '_taskId' is defined but never used
  86:21  warning  '_updates' is defined but never used

tests/unit/f005-task-detail-sheet-title-optimistic.test.tsx
  36:4   warning  '_taskId' is defined but never used
  36:21  warning  '_updates' is defined but never used

tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx
  24:4  warning  '_input' is defined but never used

tests/unit/palette-actions-recents.test.tsx
  55:36  warning  '_workspaceId' is defined but never used
  55:58  warning  '_query' is defined but never used
  74:41  warning  '_workspaceId' is defined but never used
  74:63  warning  '_pointers' is defined but never used

✖ 13 problems (0 errors, 13 warnings)
```

### `npx vitest run tests/unit`
```
 Test Files  186 passed (186)
      Tests  1408 passed (1408)
   Duration  32.80s
```

Note: `tests/integration/**` was not run. Every M1 handoff reports 50–90 failures
there attributed to live-Supabase rate limits; that claim is unverified by this review
and the integration suite's health is not a gate this milestone can currently pass or
fail on.
