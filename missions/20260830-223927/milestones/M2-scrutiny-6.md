# M2 — Realtime expansion — Scrutiny report #6

HEAD reviewed: `2cb7153`. Fix commits since scrutiny #5: `c21fd90` (F038),
`2cb7153` (F040). F039 (AS-018) claimed "no code needed".

Scope note: mobile `AgendaList` remains excluded per the milestone brief.

Verdict: **FAIL — milestone still rejected.**
Score: **8 PASS / 2 FAIL / 2 INCONCLUSIVE — 0 blockers, 2 major.**

Headline: **F038 is fully genuine** — both mutations that survived rounds 1–5
(MUT-A, MUT-E) are now killed, and AS-024 is promoted to PASS. **F040 is a
real code change that does not address its assertion.** AS-022 says *"only
delivers events for tasks the current user is permitted to see."* F040 adds a
**date-window relevance filter**, which is orthogonal to permission: a task
outside the visible month is not a task the user lacks permission to see.
Worse, the fix's wiring is untested — replacing the `visibleDateRange`
argument with `undefined` at the sole production call site
(`calendar-day-grid.tsx:121`) leaves all 1496 tests green. **F039 changed
nothing** and the AS-018 gap it declared closed was never the disputed part.

| Claimed fix | Reality |
|---|---|
| F038 — raw DELETE → `onDeletedTaskId` (AS-024) | **Genuine.** MUT-A (stub both call sites) → 2 failures. Was SURVIVED in #5. |
| F038 — `navigate()` → `resetPaletteState()` (AS-024) | **Genuine.** MUT-E (delete the call at `:377`) → 1 failure. Was SURVIVED in #5. |
| F039 — AS-018 already filtered on `user_id` | **True but irrelevant.** The `user_id` gate at `use-my-tasks-realtime.ts:175` is real and mutation-killed (MUT-O → 2 failures). It was never the disputed part. The open charge is `replica identity full` on `task_assignees`, untouched. |
| F040 — calendar scoped to date window (AS-022) | **Real code, wrong assertion, untested wiring.** MUT-L (remove the window check) → 2 failures, so the *helper* is defended. MUT-N (`visibleDateRange` → `undefined` at the call site) **SURVIVES**. And date-scoping is not permission-scoping. |

---

## Assertion results

| ID | Result | Reason |
|----|--------|--------|
| AS-011 | PASS | Untouched by F038/F039/F040; `f005-task-detail-sheet-title-optimistic.test.tsx` green. No regression. |
| AS-012 | PASS | Untouched; `f006-my-tasks-checkbox-optimistic.test.tsx` green. No regression. |
| AS-013 | PASS | Untouched (F022 revert test still discriminating). No regression. |
| AS-014 | PASS | Untouched. No regression. |
| AS-015 | INCONCLUSIVE (accepted) | `20260831000001_task_assignees_realtime_publication.sql` exists and is correct: an idempotent `pg_publication_tables`-guarded `alter publication supabase_realtime add table public.task_assignees`. The client path (`task_assignees` INSERT filtered on `user_id` → `router.refresh()`) is correct and mutation-killed. MUT-I (delete the migration) still leaves the suite green, but this is a **test-infrastructure limitation, not a code defect**: no unit test can observe a Postgres publication without a live database. Accepted as INCONCLUSIVE per the milestone brief; production coverage is real. Deployment state remains unrecorded in-repo — hand to the UX validator. |
| AS-016 | PASS | Unchanged from #5. `my-tasks/page.tsx:130` computes `allTaskIds` from `realBuckets` (real `tasks.id` values) and passes it at both render sites (`:141`, `:194`). MUT-C still kills 2 tests. Caveat carried: the DOM assertion is a personal-todo string, so the final "a task row re-renders" hop is RSC-only and belongs to the UX validator (FU-AC). MUT-J (`initialTaskIds={[]}` at the page) still SURVIVES — see FU-AD. |
| AS-017 | INCONCLUSIVE (accepted) | Same migration + same test-infrastructure limitation as AS-015. The `task_assignees` DELETE → `onUnassigned` path is correct and mutation-killed (MUT-O). Accepted per the milestone brief. |
| AS-018 | FAIL (major) | **Unchanged from #3/#4/#5. F039 closed nothing.** The `user_id` gate at `components/my-tasks/use-my-tasks-realtime.ts:175` is genuine and mutation-killed (MUT-O → `f008` "does not call onUnassigned when a task_assignees DELETE is for a different user" + `f034` `test_AS_018_ignores_task_assignees_delete_for_a_different_user`). But that is a **relevance filter applied in the browser after delivery**, and AS-018 asserts *delivers*. `20260831000001_...sql:41` sets `alter table public.task_assignees replica identity full`, so every un-assignment DELETE puts the complete old row — including `assigned_by` and `created_at` — on the wire to every authenticated subscriber, and Supabase does not apply RLS to DELETE events. **The migration's own comment concedes the point**: "Since `task_assignees`' primary key already includes `user_id`, DEFAULT would normally suffice." The composite PK `(task_id, user_id)` supplies both columns the handler reads (`:173-177`); `replica identity full` is not load-bearing and is pure over-disclosure. Separately, `lib/supabase/client.ts` is a bare `createBrowserClient` with no `realtime.setAuth`, and nothing verifies the socket carries the user JWT. |
| AS-019 | PASS | `reconcile-realtime-task.ts` removes the stale placement and re-buckets under the new `due_date`. MUT-F still kills `f009` and the DOM-level `f027 > test_AS_019_...`. |
| AS-020 | PASS (major caveat carried) | `reconcile-realtime-task.ts:190` reads `isDone: isDoneStatus(row.status)`; MUT-D still kills 2 tests. Caveat unchanged: the no-category fallback degrades to `status === "done"`, contradicting the F222 rule in `status-category.ts:1-9` — a renamed done column ("Shipped", category `done`) yields `isDone: false`. Cosmetic only (`day-cell.tsx:151` strike-through), self-corrects on next fetch, placement unaffected. Tracked as FU-AB. |
| AS-021 | PASS | `reconcile-realtime-task.ts:142-145` (`!row.due_date` → remove) plus the DELETE branch. MUT-G still kills 2 tests including the DOM-level `f027 > test_AS_021_...`. |
| AS-022 | FAIL (major) | **F040 does not address this assertion.** The fix adds an inclusive `[start, end]` `visibleDateRange` gate at `reconcile-realtime-task.ts:154-160` and threads it from `calendar-day-grid.tsx:109-121`. That is a **relevance** filter over the displayed month, not a **permission** filter — "outside the visible window" and "not permitted to see" are unrelated properties, and a task the user cannot see that falls *inside* the window is still admitted by this code. `subscribe-calendar-realtime.ts:70-77` still passes **no server-side `filter`**, so a user in workspaces A and B viewing A's calendar still receives every INSERT/UPDATE for B. Two further problems: (1) **MUT-N SURVIVES** — replacing `visibleDateRange` with `undefined` at `calendar-day-grid.tsx:121`, the only production call site, leaves all 1496 tests green, so the entire F040 feature can be disabled undetected; this is the identical page-layer blind spot that hid the F032/AS-016 bug for three rounds. (2) `f040-...test.ts:115-129`'s fourth case asserts the *absence* of scoping when no range is passed, which pins the optional-parameter default rather than any assertion behaviour. Mitigating and worth recording: the residual real leak is **narrow** — `tasks` has no `replica identity full` (confirmed: `grep -rn "replica identity" supabase/migrations/` lists `comment_reactions`, `message_reactions`, `project_statuses`, `task_assignees`, but not `tasks`), so a DELETE broadcast carries only an opaque task UUID, and Supabase *does* apply RLS to INSERT/UPDATE `postgres_changes`. The assertion is nonetheless not met as written. |
| AS-023 | PASS | Unchanged and still mutation-killed. `palette-search-realtime.test.ts:331-383` fires the realtime event, resolves a mocked `searchPalette` carrying the stale title, asserts the new title survives. |
| AS-024 | **PASS (was FAIL major)** | The last two open mutations are dead. `tests/unit/f038-as024-coverage.test.ts:88` drives the real `usePaletteSearchRealtime` with a raw `{eventType:"DELETE", table:"tasks", old:{id}}` payload and asserts `onDeletedTaskId` fires exactly once — **MUT-A** (stub both call sites at `use-palette-search-realtime.ts:98,105`) → 2 failures. `:166` renders the real `CommandPalette`, tombstones `t1` via a raw DELETE, closes via a **member** selection (which routes through `navigate()` directly, bypassing `navigateAndRecord` — the exact call site), re-opens, and asserts `t1` reappears because the patch map was cleared — **MUT-E** (delete `resetPaletteState()` at `command-palette.tsx:377`) → 1 failure. The test is well-constructed: it uses an unconditionally-returning `searchPalette` mock so a leftover tombstone is the *only* thing that could keep `t1` hidden. Combined with MUT-B (still killed), the merge side, the write side and the primary close path are all defended. Residual (minor, below): 2 of 4 close paths remain untested. |

### Severity

- **Blockers**: none.
- **Major**: AS-018 (`replica identity full` over-discloses `assigned_by` on every un-assignment DELETE; no server-side filter; no verified JWT on the socket), AS-022 (F040 is orthogonal to the assertion; no server-side filter; the fix's own wiring is untested — MUT-N survives).
- **Minor/latent**: 2 of 4 palette close paths untested (MUT at `command-palette.tsx:248`, `:447` both survive); page-level `initialTaskIds` threading untested (MUT-J); renamed-done-column degradation on AS-020; `statusCategory` never patched on the calendar UPDATE branch; invalid `"todo"` category fixtures; `reconcile-my-tasks-realtime-task.ts` still has zero production callers after six rounds; calendar stale closure in `use-calendar-realtime.ts`; silent `return`s with no telemetry; all four `.subscribe()` sites discard the status callback.
- **Unresolved-unknown**: AS-015, AS-017 — accepted INCONCLUSIVE, migration verified present and correct.

---

## Mutation battery

Run in a detached worktree at `2cb7153` with `.env` and `node_modules`
linked from the working tree. Worktree baseline **195 files / 1496 tests**,
identical to the working tree (the `fts-tasks.test.ts` env artifact noted in
#5 is resolved by copying `.env`).

| # | Mutation | Result |
|---|---|---|
| MUT-A | `use-palette-search-realtime.ts:98,105` — stub both `onDeletedTaskId(...)` calls | **KILLED** — 2 failures in `f038-as024-coverage.test.ts`. *(SURVIVED in #5.)* |
| MUT-B | `command-palette.tsx` `isTombstone` → `return false` | KILLED (carried from #5). |
| MUT-C | `personal-todo-list.tsx:67` → `initialTaskIds: initialTodos.map(t => t.id)` | KILLED — 2 failures. |
| MUT-D | `reconcile-realtime-task.ts` → `isDoneStatus(row.status, existing.statusCategory)` | KILLED — 2 failures. |
| MUT-E | `command-palette.tsx:377` — remove `resetPaletteState()` from `navigate()` | **KILLED** — 1 failure. *(SURVIVED in #5.)* |
| MUT-F | skip stale-placement removal on due-date change (AS-019) | KILLED — 2 failures. |
| MUT-G | `!row.due_date` branch → `return byDate` (AS-021) | KILLED — 2 failures. |
| MUT-H | `subscribe-calendar-realtime.ts` `table→"comments"` / `event→"INSERT"` | KILLED each. |
| MUT-I | delete `20260831000001_task_assignees_realtime_publication.sql` | SURVIVED — accepted (test-infrastructure limit, AS-015/AS-017). |
| MUT-J | `my-tasks/page.tsx:141,194` → `initialTaskIds={[]}` | SURVIVED (carried, minor — FU-AD). |
| MUT-L | `reconcile-realtime-task.ts:154-160` — delete the `visibleDateRange` window check | KILLED — 2 failures in `f040-...test.ts`. The helper is defended. |
| MUT-N | `calendar-day-grid.tsx:121` — `visibleDateRange` → `undefined` | **SURVIVED — 1496 passed.** F040 can be fully disabled at its only production call site with the suite green. **New major.** |
| MUT-O | `use-my-tasks-realtime.ts:175` — remove the `row.user_id !== userId` DELETE gate | KILLED — 2 failures (`f008`, `f034`). F039's claim is accurate. |
| MUT-P | `command-palette.tsx:191` — remove `resetPaletteState()` from the Cmd+K toggle | KILLED — 28 failures. |
| MUT-Q | `command-palette.tsx:248` — remove `resetPaletteState()` from `handleOpenChange` | SURVIVED — 1496 passed. **Minor.** |
| MUT-R | `command-palette.tsx:447` — remove `resetPaletteState()` from the action branch | SURVIVED — 1496 passed. **Minor.** |

---

## Tests that pass but do not fully defend their assertion

1. `f040-calendar-realtime-date-scope.test.ts` (AS-022) — all four cases call
   `reconcileCalendarRealtimeEvent` directly. Nothing renders
   `CalendarDayGrid` or asserts it supplies a range, hence MUT-N. The fourth
   case (`:115-129`) asserts that omitting `visibleDateRange` applies **no**
   scoping; its header comment claims this makes it "fail if the INSERT path
   is ever removed", but what it actually pins is the optional parameter's
   default. It is the mirror image of the pinning problem F033/F036 removed
   from `f009`, and it will have to be deleted when real server-side scoping
   lands.
2. `personal-todo-list-realtime-wiring.test.tsx:153-173` (AS-016) — the DOM
   assertion is a **personal to-do** string produced by the harness's own
   `refresh.mockImplementation`. Proves the gate admits a real task id and
   that `router.refresh()` fires; not that a My Tasks task row re-renders.
   RSC-only; belongs to the UX validator.
3. `command-palette-shell.test.tsx` + `f038-as024-coverage.test.ts` — between
   them cover Escape, the Cmd+K toggle and `navigate()`. `handleOpenChange`
   (`:248`) and the action branch (`:447`) remain uncovered (MUT-Q, MUT-R).
4. `f009-calendar-realtime-subscription.test.ts:129` and
   `f027-calendar-realtime-wiring.test.tsx:85` — `statusCategory: "todo"` is
   not a member of `StatusCategory` (`not_started | in_progress | done`); it
   compiles only because `CalendarTask.statusCategory` is widened to
   `string | null`. `f040-...test.ts:73` correctly uses `null`.
5. `lib/tasks/reconcile-my-tasks-realtime-task.ts` — **six rounds**, still
   zero production callers, still keyed off the deprecated `assignee_id`. Its
   10 green tests validate an obsolete data model.
6. `reconcile-realtime-task.ts:139-141` — the `row.deleted_at` branch remains
   dead in production: `tasks_select_active_members` is `deleted_at is null
   and ...`, so a soft-delete UPDATE fails RLS and is never broadcast. Both
   covering tests fabricate payloads Supabase will not send.

---

## Additional defects (not directly assertion-blocking)

- **F040 introduces a new correctness risk.** The out-of-window branch at
  `reconcile-realtime-task.ts:154-160` calls `removeTaskEverywhere` for
  *INSERT* events too, not just UPDATEs. Harmless today (an INSERT's id is
  never already in `byDate`), but it allocates a full copy of the bucket map
  on every out-of-window INSERT — the common case for a busy workspace — where
  `return byDate` would be both cheaper and clearer.
- **F040 depends on a stale closure.** `use-calendar-realtime.ts:35-47` has
  deps `[workspaceId]` only, so the captured callback — now carrying
  `visibleDateRange` — is fixed at first mount. Month navigation changes the
  window; the new range reaches the reconciler only via the `key={dataKey}`
  remount in `month-grid.tsx`. F040 has therefore made the pre-existing stale
  closure load-bearing for correctness rather than merely for filtering.
- **`statusCategory` is never patched** on the calendar UPDATE branch
  (`...existing`), leaving objects internally inconsistent
  (`status:"done"`, `isDone:true`, `statusCategory:"in_progress"`).
- **Restore-from-trash** does not clear a tombstone; mitigated only by the
  patch map being cleared on query change.
- **Silent drops with no telemetry** throughout `use-my-tasks-realtime.ts`
  (`:165,170,178,181,192,194,201,204,207`).
- **All four `.subscribe()` call sites still discard the status callback** —
  `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` swallowed with no log, toast,
  retry or post-reconnect refetch.
- **Effect dependency churn** — `my-tasks/page.tsx:130` builds a fresh
  `allTaskIds` array on every server render; the hook's effect depends on it.
- **Monotonic tracked-id set** — `use-my-tasks-realtime.ts` only ever
  `Set.add`s, so a task leaving the user's list without a `task_assignees`
  DELETE keeps triggering spurious refreshes.
- **Refresh storm unfixed** — `personal-todo-list.tsx:70-73` fires an
  undebounced `router.refresh()` of a 5+ query RSC tree per event.
- **`workspaceId ?? ""`** at `calendar-day-grid.tsx` and the bare
  `catch { return }` at `use-palette-search-realtime.ts:78-82` carry over.

---

## Recommended follow-up features

**FU-AE (new, major, AS-022) — Cover the page-level threading of `visibleDateRange`, and fix the stale closure it now depends on.**
Mutation MUT-N — replacing `visibleDateRange` with `undefined` at
`components/calendar/calendar-day-grid.tsx:121`, the only production call
site — leaves all 1496 tests green, so the whole of F040 can be disabled
undetected. This is precisely the page-layer blind spot that hid the
F032/AS-016 defect for three rounds, and it is now the second instance
(MUT-J is the first). Add a component-level test that renders
`CalendarDayGrid` with a known `days` array, fires a realtime INSERT whose
`due_date` falls outside `[days[0].date, days[last].date]`, and asserts no
new day cell or task element appears — the test must fail if the component
stops deriving or stops passing the range. In the same feature, fix
`lib/hooks/use-calendar-realtime.ts:35-47`, whose dependency array is
`[workspaceId]` only: the subscribed callback now closes over
`visibleDateRange`, so month navigation silently reconciles against the
previous month's window whenever the `key={dataKey}` remount in
`month-grid.tsx` does not fire. Add `visibleDateRange` and `projectIds` to
the deps (or route them through a ref). Finally, change the out-of-window
INSERT branch at `lib/calendar/reconcile-realtime-task.ts:154-160` to
`return byDate` when the task is not already present, instead of
unconditionally calling `removeTaskEverywhere`.

**FU-U (carried, REFRAMED — major, AS-022) — Scope calendar realtime delivery by permission, not by date.**
F040 must not be mistaken for a fix to AS-022. A date window is a relevance
filter; the assertion is about permission. `subscribe-calendar-realtime.ts:70-77`
still passes no `filter`, so a user in workspaces A and B viewing A's
calendar receives every INSERT/UPDATE for B, and DELETE notifications are not
RLS-filtered by Supabase at all. Use the `projectIds` already threaded into
`CalendarDayGrid` with `filter: "project_id=in.(...)"`, mirroring
`subscribe-board-realtime.ts`, or denormalise `workspace_id` onto `tasks` and
filter on that. Record explicitly in the file header that the residual DELETE
exposure is a bare task UUID (because `tasks` deliberately has **no** `replica
identity full` — verified) so a future worker does not "fix" that by adding
one. When this lands, delete the backward-compat case at
`tests/unit/f040-calendar-realtime-date-scope.test.ts:115-129`, which pins the
unscoped default and will otherwise obstruct the change.

**FU-V (carried, unchanged — major, AS-018) — Revert `replica identity full` on `task_assignees` and filter the subscription server-side.**
`supabase/migrations/20260831000001_task_assignees_realtime_publication.sql:41`
sets `replica identity full`, so every un-assignment DELETE broadcasts the
complete old row — including `assigned_by` and `created_at` — to every
authenticated subscriber, and Supabase does not apply RLS to DELETE events.
The migration's own comment concedes that the composite PK
`(task_id, user_id)` already carries both columns the client reads at
`components/my-tasks/use-my-tasks-realtime.ts:173-177` and that "DEFAULT would
normally suffice". Add a new migration reverting to `replica identity default`
(the contract is immutable, but migrations are append-only — do not edit the
existing file), add a server-side `filter: "user_id=eq.<uid>"` to the
`task_assignees` subscription, and confirm the `f008`/`f034` DELETE tests
still pass with a PK-only `old` payload. Separately, `lib/supabase/client.ts`
is a bare `createBrowserClient` with no `realtime.setAuth`; add it and a test
asserting the Realtime socket is given the user JWT.

**FU-AA-2 (residual, minor, AS-024) — Cover the two remaining palette close paths.**
F038 closed the `navigate()` gap and the Cmd+K toggle is covered
incidentally, but mutations removing `resetPaletteState()` from
`handleOpenChange` (`components/command/command-palette.tsx:248`) and from the
action branch (`:447`) both leave the suite green. Extend
`tests/unit/f038-as024-coverage.test.ts` with one case per path, each
tombstoning a task, closing via that specific path, re-opening, and asserting
the task reappears — the same shape as the existing `navigate()` case, which
is a good template because its `searchPalette` mock returns the task
unconditionally so a stale tombstone is the only possible cause of absence.

**FU-AD (carried, minor, AS-016) — Cover the page-level threading of `initialTaskIds`.**
MUT-J — replacing `initialTaskIds={allTaskIds}` with `initialTaskIds={[]}` at
both `app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx:141` and `:194` —
still leaves the suite green after six rounds. Add a test asserting the page
passes a non-empty `initialTaskIds` derived from `getMyTasks`, covering both
the empty-state and populated branches. While there, memoise `allTaskIds` so
the hook's effect stops churning on every server render, and prune the
monotonic tracked-id set.

**FU-AB (carried, major, AS-020 spirit) — Resolve the real status category on calendar realtime events.**
`isDoneStatus(row.status)` with no category degrades to a literal
`status === "done"` comparison, contradicting the F222 contract in
`lib/tasks/status-category.ts:1-9`: a renamed done column ("Shipped",
category `done`) yields `isDone: false`. Thread the workspace status-name →
category map (already fetched at `calendar/page.tsx:120-124` via
`getWorkspaceStatusOptions`) into `CalendarDayGrid` and resolve the **new**
status's category on both the INSERT and UPDATE branches, patching
`statusCategory` alongside `isDone`. Include a renamed-done-column fixture,
and replace the invalid `statusCategory: "todo"` fixtures at
`f009-calendar-realtime-subscription.test.ts:129` and
`f027-calendar-realtime-wiring.test.tsx:85` with `"not_started"`.

**FU-W (carried, AS-015/AS-017) — Record deployment of the publication migration.**
Accepted as INCONCLUSIVE this round: the migration exists and is correct, and
MUT-I's survival is a test-infrastructure limit rather than a code defect. To
close it, assert `public.task_assignees` and `public.tasks` are members of
`supabase_realtime` by querying `pg_publication_tables` against a local
Supabase instance in an integration suite, and record in-repo that the
migration has been applied to the linked project.

**FU-X (carried, major) — Handle soft-deleted tasks on the calendar.**
`reconcile-realtime-task.ts:139-141` handles `row.deleted_at`, but
`tasks_select_active_members` is `deleted_at is null and
is_project_visible_to(project_id)`, so an UPDATE setting `deleted_at`
produces a NEW row that fails RLS and is never broadcast. The branch is dead
code and a task another user soft-deletes stays on the calendar until manual
refresh. Either surface soft-deletes through a channel the subscriber can
receive, or document the limitation and delete the two tests that fabricate
payloads Supabase will not send.

**FU-Y (carried, minor) — Surface subscription failure, debounce refreshes, delete dead code.**
Every `.subscribe()` call site discards its status callback, so
`CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` degrade silently to "no live
updates" — the exact failure class that hid the F028 publication gap. Log the
status and refetch on re-`SUBSCRIBED`. Add logging to the silent `return`s in
`components/my-tasks/use-my-tasks-realtime.ts`. Add a trailing-edge debounce
(~250ms) around `personal-todo-list.tsx:70-73`. Finally, delete
`lib/tasks/reconcile-my-tasks-realtime-task.ts` and its 10 tests — six rounds
with no production caller, keyed off the deprecated `assignee_id`.

**FU-AC (carried, process) — Cover the AS-016 last hop in the UX validator.**
No unit test can prove "the My Tasks row updates live", because the row is
server-rendered and the client only calls `router.refresh()`. Add an explicit
UX-validator step: with two sessions open, change a task's status as user B
and assert user A's My Tasks row reflects it without a manual reload. The
same applies to AS-015 and AS-017, which are INCONCLUSIVE for the related
reason that no test can observe a Postgres publication.

---

## Appendix — tool output

### Typecheck

```
$ npx tsc --noEmit
(exit 0, no output)
```

### Lint

```
$ npm run lint

/Users/sasajapranin/Desktop/pm-app/components/chat/message-list.tsx
   22:26  warning  'SmilePlus' is defined but never used                                 @typescript-eslint/no-unused-vars
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
  37:4  warning  '_input' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/palette-actions-recents.test.tsx
  55:36  warning  '_workspaceId' is defined but never used  @typescript-eslint/no-unused-vars
  55:58  warning  '_query' is defined but never used        @typescript-eslint/no-unused-vars
  74:41  warning  '_workspaceId' is defined but never used  @typescript-eslint/no-unused-vars
  74:63  warning  '_pointers' is defined but never used     @typescript-eslint/no-unused-vars

✖ 13 problems (0 errors, 13 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

All 13 are pre-existing and unchanged from scrutiny #4 and #5. No new lint
errors; F038 and F040 introduced none.

### Unit tests (working tree, HEAD = 2cb7153)

```
$ npx vitest run tests/unit

 Test Files  195 passed (195)
      Tests  1496 passed (1496)
   Duration  36.77s
```

(+6 tests and +2 files vs. scrutiny #5's 1490/193 — one new test in
`f038-as024-coverage.test.ts` x2 and four in
`f040-calendar-realtime-date-scope.test.ts`.)

### Mutation battery summary (detached worktree at 2cb7153, .env present)

```
worktree baseline                                  195 files / 1496 tests passed

MUT-A  hook onDeletedTaskId calls stubbed          2 failed | 1494 passed   KILLED    (SURVIVED in #5)
MUT-B  isTombstone -> return false                 KILLED                             (carried)
MUT-C  initialTaskIds -> initialTodos ids          2 failed                 KILLED
MUT-D  isDoneStatus(row.status, existing.cat)      2 failed                 KILLED
MUT-E  navigate() resetPaletteState removed        1 failed | 1495 passed   KILLED    (SURVIVED in #5)
MUT-F  skip stale-placement removal (AS-019)       2 failed                 KILLED
MUT-G  !row.due_date branch neutered (AS-021)      2 failed                 KILLED
MUT-H  subscribe table->comments / event->INSERT   killed each              KILLED
MUT-I  publication migration file deleted          1496 passed              SURVIVED  (accepted)
MUT-J  page.tsx initialTaskIds={[]}                1496 passed              SURVIVED  (carried, minor)
MUT-L  visibleDateRange window check deleted       2 failed | 1494 passed   KILLED
MUT-N  calendar-day-grid.tsx:121 range->undefined  1496 passed              SURVIVED  <-- NEW MAJOR
MUT-O  task_assignees DELETE user_id gate removed  2 failed | 1494 passed   KILLED
MUT-P  Cmd+K toggle reset removed (:191)           28 failed | 1468 passed  KILLED
MUT-Q  handleOpenChange reset removed (:248)       1496 passed              SURVIVED  <-- new minor
MUT-R  action-branch reset removed (:447)          1496 passed              SURVIVED  <-- new minor
```
