# M2 — Realtime expansion — Scrutiny report #7

HEAD reviewed: `e8b3908`. Fix commits since scrutiny #6: `d4339a2` (F042),
`306cb3b` (F041), `e8b3908` (F043).

Scope note: mobile `AgendaList` remains excluded per the milestone brief.

Verdict: **FAIL — one major remains.**
Score: **10 PASS / 1 FAIL / 2 INCONCLUSIVE (accepted) — 0 blockers, 1 major.**

Headline: **F041 and F042 are genuine and fully close AS-022 and AS-018.**
MUT-N is dead, `task_assignees` is back to REPLICA IDENTITY DEFAULT, and the
real permission gate behind AS-022 is mutation-killed. **F043 is not.** Its
central claim — that the `resetPaletteState()` call in the quick-action
branch (`command-palette.tsx:447`) is an *equivalent mutant* — is **false**,
and I disproved it empirically. The line is load-bearing, the mutant is
killable in ~70 lines of test, and the fourth F043 test is tautological
while its committed comment documents a false invariant that actively
invites a future engineer to delete working code.

The brief instructed me to accept the `:447` mutant as INCONCLUSIVE. I am
not doing so, because the premise of that instruction is factually wrong and
I have a failing reproduction.

| Claimed fix | Reality |
|---|---|
| F041 — MUT-N wiring test (AS-022) | **Genuine.** MUT-N now KILLED (1 failure). Spy wraps the real impl via `importActual`; expectation is a hardcoded literal, not re-derived from `days()`. |
| F041 — stale-closure fix in `use-calendar-realtime.ts` | **Harmless, but the stated rationale is wrong.** See AS-022 note. |
| F041 — rewrote the vacuous 4th f040 test | **Genuine improvement.** Now a differential comparison; no longer pins the optional-parameter default. |
| F042 — REPLICA IDENTITY DEFAULT (AS-018) | **Genuine and correct.** PK verified as composite `(task_id, user_id)`. |
| F043 — `handleOpenChange` close path (AS-024) | **Genuine.** MUT-Q now KILLED (1 failure). |
| F043 — `:447` "equivalent mutant" (AS-024) | **FALSE.** Falsified by construction and by a failing test. See AS-024. |

---

## Assertion results

| ID | Result | Reason |
|----|--------|--------|
| AS-011 | PASS | Untouched by F041/F042/F043; suite green. No regression. |
| AS-012 | PASS | Untouched; suite green. No regression. |
| AS-013 | PASS | Untouched. No regression. |
| AS-014 | PASS | Untouched. No regression. |
| AS-015 | INCONCLUSIVE (accepted) | Unchanged from #6. Publication migration present and correct; MUT-I still survives, but no unit test can observe a Postgres publication without a live database. Test-infrastructure limit, not a code defect. Deployment state still unrecorded in-repo — hand to the UX validator. |
| AS-016 | PASS | Unchanged from #6. MUT-C still kills 2 tests. Caveats carried: the DOM assertion is a personal-todo string (RSC-only final hop, FU-AC); MUT-J (`initialTaskIds={[]}` at the page) still survives (FU-AD). |
| AS-017 | INCONCLUSIVE (accepted) | Same migration + same test-infrastructure limit as AS-015. `task_assignees` DELETE → `onUnassigned` path mutation-killed (MUT-O → 2 failures). |
| AS-018 | **PASS (was FAIL major)** | F042's `20260831000002_task_assignees_replica_identity_default.sql` reverts `task_assignees` to REPLICA IDENTITY DEFAULT. I verified the load-bearing premise independently rather than trusting the comment: `20260822020000_task_assignees_table.sql:44` declares `primary key (task_id, user_id)`, so DEFAULT still puts `user_id` on the wire and the browser-side gate at `use-my-tasks-realtime.ts:175` keeps working — MUT-O confirms it still kills 2 tests. I also confirmed migration ordering is final: `grep -rn "replica identity" supabase/migrations/` shows `...000002` is the last statement touching `task_assignees`, and no later migration (through `202609051100000`) re-applies FULL. DELETE broadcasts now carry only the two PK columns; `assigned_by` and `created_at` no longer leak to every authenticated subscriber. The over-disclosure charge from #3–#6 is closed. Residual (minor, unchanged): `lib/supabase/client.ts` is a bare `createBrowserClient` with no `realtime.setAuth`, and nothing verifies the socket carries the user JWT. |
| AS-019 | PASS | MUT-F still kills `f009` and the DOM-level `f027 > test_AS_019_...`. |
| AS-020 | PASS (major caveat carried) | MUT-D still kills 2 tests. Caveat unchanged: the no-category fallback degrades to `status === "done"`, so a renamed done column yields `isDone: false`. Cosmetic, self-correcting, placement unaffected. Tracked as FU-AB. |
| AS-021 | PASS | MUT-G still kills 2 tests including the DOM-level `f027 > test_AS_021_...`. |
| AS-022 | **PASS (was FAIL major)** | Two independent things had to be true, and both now are. (1) **MUT-N is dead.** Replacing `visibleDateRange` with `undefined` at `calendar-day-grid.tsx:121` — the sole production call site — now produces 1 failure in `f027-calendar-realtime-wiring.test.tsx:268-298`. The test wraps the *real* `reconcileCalendarRealtimeEvent` via `importActual` and asserts `lastCallArgs[3]` equals a **hardcoded literal** `{start:"2026-09-01", end:"2026-09-05"}` rather than re-deriving it from `days()`, so it does not mirror the implementation; it also kills argument-reorder and `days[0]`/`days[last]` swap mutants. (2) **The assertion is met by mechanisms that are not F040.** #6 correctly held that a date window is not a permission boundary, and that remains true — but on re-examination the actual permission gating exists and is defended: server-side RLS (`tasks_select_active_members`) filters INSERT/UPDATE `postgres_changes`, and the client backstop `reconcile-realtime-task.ts:137` (`!visibleProjectIds.has(row.project_id)`) drops cross-workspace rows delivered over the unfiltered channel. I mutation-tested that gate specifically (**MUT-S**, `if (false)`) → **2 failures**, so it is load-bearing and defended. `tasks` still has no `replica identity full`, so DELETE carries only an opaque UUID. No path was found by which a task in a project the caller cannot see reaches rendered state. Caveats, both minor: (a) the F040 date-window work is *relevance* filtering wearing an AS-022 badge and should carry its own assertion id; (b) the F041 stale-closure rationale in `use-calendar-realtime.ts:35-46` is **contradicted by the code** — `month-grid.tsx:134` passes `key={dataKey}` where `dataKey` embeds the month, so month navigation already forces a full remount and the "stale closure across months" bug it claims to fix was unreachable. Adding a per-render-new inline closure to the deps makes the effect tear down and re-acquire on *every render*; that is safe only because `shared-topic-channel.ts:126-139` defers teardown by a macrotask and cancels on re-acquire. Net: churn, not a bug, justified by a wrong story. |
| AS-023 | PASS | Unchanged and still mutation-killed. |
| AS-024 | **FAIL (major)** | The shipped **behaviour** is correct on every path I could reach, and F043's `handleOpenChange` test is a genuine kill (**MUT-Q** → 1 failure, was SURVIVED in #6). MUT-A and MUT-E remain killed (2 and 1 failures). The failure is the `:447` claim. F043's commit message and the comment at `f038-as024-coverage.test.ts:325-344` assert that the branch is an equivalent mutant because "`handleQueryChange` already clears the map, and the realtime subscription itself is torn down, the instant the query goes empty." **Both halves are false, and they are false in the same place.** The consumer gate is *trimmed* — `hasQuery = query.trim().length > 0` (`:366-367`), which is what renders the Actions group at `:428` — but the subscription gate is *untrimmed* — `query.length === 0` (`use-palette-search-realtime.ts:69`). A whitespace-only query therefore lands in a state the claim says is unreachable: `hasQuery` is false so the quick actions render, while `query.length === 2` so the realtime channel is **live**. A DELETE arriving in that window calls `handleTaskDeleted` (`:355`) and writes `{_deleted:true}` into a map that `handleQueryChange` will never clear again, because it only clears on the *empty-trimmed* branch (`:267-273`) and a subsequent real search has a non-empty query. `applyRealtimePatches` (`:288`) then filters that task out of every future response for the life of the component. I did not stop at the argument: I built a probe that types a space, fires a raw DELETE for `t1`, closes via "Toggle theme" (`actions.ts:113` returns `navigateTo: null`, i.e. exactly the `:447` branch), reopens, searches, and asserts `t1` reappears. **It passes on production code and fails under MUT-R.** So `:447` is load-bearing, the mutant is killable, and the fourth F043 test — whose final assertion holds identically with and without `:447` because the query was already cleared at `:345` — provides line coverage only. Per the review mandate ("if a test only confirms the implementation rather than the assertion's intent, mark the assertion FAILED even if the test passes today"), this is a FAIL. Severity **major**, not blocker: the assertion's behaviour *is* met by the shipped code; what is missing is any test defending it, plus an in-repo comment that misdocuments a real invariant as a non-invariant. |

### Severity

- **Blockers**: none.
- **Major**: AS-024 — `command-palette.tsx:447` is undefended by any test, the covering test is tautological, and the committed comment states a false equivalence that invites deletion of load-bearing code.
- **Minor/latent**: whitespace-only query opens a Realtime channel whose events can never reach a search UI (trimmed/untrimmed gate inconsistency — the root cause of the AS-024 finding); F041's stale-closure rationale contradicted by `key={dataKey}`, buying per-render subscribe churn; F040 date-scoping filed under AS-022 without its own assertion id; page-level `initialTaskIds` threading untested (MUT-J); renamed-done-column degradation on AS-020 (FU-AB); no `realtime.setAuth` on the browser client; `reconcile-my-tasks-realtime-task.ts` still has zero production callers after seven rounds; invalid `"todo"` category fixtures; silent `return`s with no telemetry; all four `.subscribe()` sites discard the status callback (a dropped socket leaves stale data with no user-visible signal).
- **Unresolved-unknown**: AS-015, AS-017 — accepted INCONCLUSIVE.

---

## Mutation battery

Run in a detached worktree at `e8b3908` with `.env` and `node_modules`
linked from the working tree. Baseline **195 files / 1499 tests, all green**
(up from 1496 in #6). Scope: `tests/unit` only — a full `vitest run` also
executes `tests/integration`, which hits live Supabase and fails 44 tests on
auth rate-limiting, unrelated to this milestone (output appended below).

| # | Mutation | Result |
|---|---|---|
| MUT-A | `use-palette-search-realtime.ts:98,105` — stub both `onDeletedTaskId(...)` calls | KILLED — 2 failures. No regression. |
| MUT-E | `command-palette.tsx:377` — remove `resetPaletteState()` from `navigate()` | KILLED — 1 failure. No regression. |
| MUT-L | `reconcile-realtime-task.ts:155` — disable the `visibleDateRange` window check | KILLED — 3 failures. |
| MUT-N | `calendar-day-grid.tsx:121` — `visibleDateRange` → `undefined` | **KILLED — 1 failure.** *(SURVIVED in #6. F041 confirmed.)* |
| MUT-O | `use-my-tasks-realtime.ts:175` — remove the `row.user_id !== userId` DELETE gate | KILLED — 2 failures. |
| MUT-Q | `command-palette.tsx:248` — remove `resetPaletteState()` from `handleOpenChange` | **KILLED — 1 failure.** *(SURVIVED in #6. F043 confirmed.)* |
| MUT-R | `command-palette.tsx:447` — remove `resetPaletteState()` from the action branch | **SURVIVED — 1499 passed.** **Not an equivalent mutant** — killed by the probe below. |
| MUT-S | `reconcile-realtime-task.ts:137` — `if (false)` in place of the `visibleProjectIds` gate | KILLED — 2 failures. **New.** Confirms the real AS-022 permission gate is defended. |
| MUT-I | delete the `task_assignees` publication migration | SURVIVED — accepted (test-infrastructure limit, AS-015/AS-017). |
| MUT-J | `my-tasks/page.tsx:141,194` → `initialTaskIds={[]}` | SURVIVED (carried, minor — FU-AD). |

### MUT-R falsification (the load-bearing evidence)

A throwaway probe was written in the scratch worktree only — **no file in the
repository was created, modified, or deleted by this review.** It reproduces
the whitespace-query window end-to-end through the real `CommandPalette`:

1. Open the palette, type `"  "` — `hasQuery` false (Actions render) while
   `query.length === 2` (realtime subscribed). Both asserted, and both hold.
2. Fire a raw `{eventType:"DELETE", table:"tasks", old:{id:"t1"}}` → tombstone
   written while `hasQuery` is false.
3. Close via `"Toggle theme"` — the `:447` branch.
4. Reopen, search `"old"`, assert `"Old title"` is in the document.

Result: **passes on `e8b3908`; fails under MUT-R** (`getByText("Old title")`
times out). The remediation is one character: in
`f038-as024-coverage.test.ts:345`, set the input to `" "` instead of `""`
before firing the delete, so the tombstone is live when the action branch
runs. That converts the tautological fourth test into a real kill.

---

## Tests that pass but do not fully defend their assertion

1. `f038-as024-coverage.test.ts:289` (AS-024) — the quick-action case is
   **tautological**: its final assertion holds identically with and without
   `:447`. Line coverage only. Its comment (`:325-344`) additionally records
   a false invariant.
2. `f038-as024-coverage.test.ts:231` (AS-024) — a genuine but **coarse**
   kill: the second `fireEvent.change(..., "old")` on an already-`"old"`
   controlled input dispatches no change event, so the test would also fail
   if only `setQuery("")` were dropped. It kills the stated mutant; it does
   not isolate it.
3. `personal-todo-list-realtime-wiring.test.tsx:153-173` (AS-016) — DOM
   assertion is a **personal to-do** string from the harness's own
   `refresh.mockImplementation`. RSC-only final hop; belongs to the UX
   validator.
4. `f040-calendar-realtime-date-scope.test.ts` (AS-022) — now non-vacuous
   after F041, but every case still exercises *relevance*, not permission,
   while being named `AS-022` throughout. The genuine AS-022 coverage lives
   in the `visibleProjectIds` tests (MUT-S).
5. `f009-...:129` and `f027-...:85` — `statusCategory: "todo"` is not a
   member of `StatusCategory`; compiles only because the field is widened to
   `string | null`.
6. `lib/tasks/reconcile-my-tasks-realtime-task.ts` — **seven rounds**, still
   zero production callers, still keyed off the deprecated `assignee_id`.
   10 green tests validating an obsolete data model.
7. `reconcile-realtime-task.ts:139-141` — the `row.deleted_at` branch is dead
   in production (a soft-delete UPDATE fails RLS and is never broadcast).
   Both covering tests fabricate payloads Supabase will not send.

---

## Recommended follow-up features

**FU-AE (major, AS-024) — kill MUT-R and correct the false invariant.**
Amend the fourth case in `tests/unit/f038-as024-coverage.test.ts` so the
realtime patch map is non-empty at the moment the quick-action branch runs:
set the palette input to a single space (not the empty string) before firing
the raw DELETE, then close via the "Toggle theme" action, reopen, search for
a non-empty query, and assert the task reappears. Verify the test fails when
`resetPaletteState()` is removed from `command-palette.tsx:447`. Delete the
comment block at `:325-344` asserting equivalence and replace it with a note
that the branch is load-bearing specifically because the subscription gate is
untrimmed while `hasQuery` is trimmed. No production change required.

**FU-AF (minor) — unify the trimmed/untrimmed query gates.**
`usePaletteSearchRealtime` subscribes on `query.length === 0` while every
consumer gate uses `query.trim()`. A whitespace-only query therefore opens a
Realtime channel whose events can only ever reach a UI that is not showing
search results. Change the hook's gate (and its `query.length > 0` dep) to
use the trimmed query so subscription lifetime matches the state that
consumes it. This removes the root cause behind FU-AE; land it *after*
FU-AE, otherwise the new test's window closes and the mutant becomes
genuinely equivalent — at which point FU-AE's test should be kept as a
regression guard with an updated comment.

**FU-AG (minor, AS-022) — correct the F041 comment and stabilise the callback.**
The rationale in `use-calendar-realtime.ts:35-46` claims month navigation left
a stale `visibleDateRange` closure alive; `month-grid.tsx:134`'s
`key={dataKey}` already forces a remount per month, so that bug was
unreachable. Rewrite the comment to say what the deps entry actually buys,
and wrap `onDueDateChange` (and the `visibleProjectIds` Set) at
`calendar-day-grid.tsx:103-125` in `useCallback`/`useMemo` so the effect stops
tearing down and re-acquiring the shared channel on every render.

**FU-AH (minor) — give calendar date-scoping its own assertion id.**
F040/F041's `visibleDateRange` work is relevance filtering, not authorization,
but is labelled AS-022 across three files. Allocate a new assertion covering
"realtime events for dates outside the displayed window do not mutate calendar
state" and re-label the F040 tests. The contract is immutable, so this is an
addition, not an edit.

**FU-AI (minor) — surface realtime subscription failures.**
All four `.subscribe()` sites discard the status callback. A dropped socket
leaves every realtime surface silently stale. Handle
`CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` with a refetch on recovery and a
user-visible stale indicator.

Carried forward unchanged: FU-AB (AS-020 renamed-done-column), FU-AC
(AS-016 RSC hop → UX validator), FU-AD (MUT-J page-level `initialTaskIds`).

---

## Appendix — full tool output

### Typecheck — `npx tsc --noEmit` (working tree)

Clean. No output, exit 0.

(In the detached worktree this reports
`app/layout.tsx(32,50): error TS2304: Cannot find name 'LayoutProps'` — a
worktree artifact from absent Next-generated `.next/types`, not a code
defect. Confirmed clean in the real tree.)

### Lint — `npx eslint .`

```
✖ 13 problems (0 errors, 13 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

All 13 are pre-existing `no-unused-vars` warnings on underscore-prefixed test
parameters, plus one unused `eslint-disable` directive at
`components/chat/message-list.tsx:161` and an unused `SmilePlus` import at
`:22`. None introduced by F041/F042/F043. Zero errors.

### Unit tests — `npx vitest run tests/unit` (baseline, worktree @ e8b3908)

```
 Test Files  195 passed (195)
      Tests  1499 passed (1499)
   Duration  39.38s
```

### Full suite — `npx vitest run` (for the record)

```
 Test Files  49 failed | 339 passed (388)
      Tests  44 failed | 2513 passed | 235 skipped (2792)
   Duration  501.69s
```

Every failure is in `tests/integration/**` and is an environment artifact, not
a milestone regression — the integration suites sign real users into a live
Supabase project and hit the auth rate limiter:

```
FAIL tests/integration/workspace-members-list.test.ts > getWorkspaceMembers (F017: AS-023)
Error: Failed to sign in test user f017-owner-...@example.com: Request rate limit reached
  ❯ signInAs tests/integration/workspace-members-list.test.ts:117:13
```

These suites are not part of the M2 assertion set and were excluded from the
mutation battery for determinism.

### Mutation runs (summary lines)

```
MUT-N  (calendar-day-grid.tsx:121 -> undefined)      Tests  1 failed | 1498 passed (1499)
MUT-Q  (command-palette.tsx:248 removed)             Tests  1 failed | 1498 passed (1499)
MUT-R  (command-palette.tsx:447 removed)             Tests  1499 passed (1499)
MUT-O  (use-my-tasks-realtime.ts:175 removed)        Tests  2 failed | 1497 passed (1499)
MUT-L  (reconcile-realtime-task.ts:155 disabled)     Tests  3 failed | 1496 passed (1499)
MUT-E  (command-palette.tsx:377 removed)             Tests  1 failed | 1498 passed (1499)
MUT-A  (use-palette-search-realtime.ts:98,105)       Tests  2 failed | 1497 passed (1499)
MUT-S  (reconcile-realtime-task.ts:137 -> if(false)) Tests  2 failed | 1497 passed (1499)
```

### MUT-R probe (scratch worktree only; nothing written to the repo)

```
production e8b3908:  Test Files  1 passed (1)   Tests  1 passed (1)
under MUT-R:         Test Files  1 failed (1)   Tests  1 failed (1)

 ❯ tests/unit/zz-probe-mutr.test.ts:72:11
     72|     await waitFor(() => { expect(screen.getByText("Old title")).toBeIn…
```

Probe deleted and the worktree restored to a clean checkout after the run.
