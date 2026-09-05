# M2 — Realtime expansion — Scrutiny report #5

HEAD reviewed: `f6dcaae`. Fix commits since scrutiny #4: `ba6b031` (F036),
`46e5912` (F035), `f6dcaae` (F037).

Scope note: mobile `AgendaList` remains excluded per the milestone brief.

Verdict: **FAIL — milestone still rejected, but the three scrutiny-4 blockers
are cleared.**
Score: **7 PASS / 3 FAIL / 2 INCONCLUSIVE — 0 blockers, 3 major.**

Headline: unlike round 4, **all three claimed fixes are real and mutation-killed.**
Reverting each fix to its pre-fix form now turns the suite red. The remaining
failures are the two carried-over `major`s (AS-018, AS-022) plus one newly
promoted gap: the AS-024 **tombstone-write** path and every palette close-path
reset are entirely untested — the merge function is now defended, the wiring
into it is not.

| Claimed fix | Reality |
|---|---|
| F035 — real task ids (AS-016) | **Genuine.** `allTaskIds` flattened from `realBuckets`, passed at both render sites. Reverting to todo ids kills 2 tests. |
| F036 — isDone from new status (AS-020) | **Genuine.** `isDoneStatus(row.status)` with no category. Restoring `existing.statusCategory` kills 2 tests. |
| F036 — AS-022 test un-pinned | **Genuine and not over-loosened.** Still pins channel/event/schema/table; `table→"comments"` and `event→"INSERT"` each kill it. |
| F037 — AS-024 real import | **Half genuine.** `applyRealtimePatches`/`isTombstone` are now exported and exercised for real (gutting `isTombstone` kills the test). But the tombstone **write** is hand-fabricated in the test; deleting the production write path leaves the suite green. |

---

## Assertion results

| ID | Result | Reason |
|----|--------|--------|
| AS-011 | PASS | Untouched by F035/F036/F037; `f005-task-detail-sheet-title-optimistic.test.tsx` green. No regression. |
| AS-012 | PASS | Untouched; `f006-my-tasks-checkbox-optimistic.test.tsx` green. No regression. |
| AS-013 | PASS | Untouched (F022 revert test still discriminating). No regression. |
| AS-014 | PASS | Untouched. No regression. |
| AS-015 | INCONCLUSIVE | Unchanged from #3/#4. Client path (`task_assignees` INSERT filtered on `user_id` → `router.refresh()`) is correct and the publication migration exists, but **deleting `20260831000001_task_assignees_realtime_publication.sql` still leaves the suite green**, and nothing in the repo records that the migration was applied to the linked project. Not verifiable without a live database. |
| AS-016 | **PASS (was blocker)** | `my-tasks/page.tsx:130` computes `allTaskIds = BUCKET_ORDER.flatMap(({key}) => realBuckets[key].map(r => r.id))` — real `tasks.id` values from `getMyTasks` — and passes them at **both** the empty-state (`:141`) and populated (`:194`) render sites. `personal-todo-list.tsx:67` forwards the prop verbatim; `initialTodos` is no longer conflated with tasks. Fixture ids are now genuinely distinct (`todo-1` vs `task-1`, `personal-todo-list-realtime-wiring.test.tsx:104,122,166`). **Mutation MUT-C** (revert to `initialTodos.map(t => t.id)`) → 2 failures. See caveat under "Tests that pass but do not fully defend their assertion" #1: the DOM assertion is still a personal-todo string, so this proves *the gate admits the event and refresh fires*, not that a task row re-renders. That last hop is RSC-only and belongs to the UX validator. |
| AS-017 | INCONCLUSIVE | Same deployment-state gap as AS-015. Unchanged. |
| AS-018 | FAIL (major) | Unchanged from #3/#4. The tracked-id set is a **relevance** filter applied in the browser, not an authorization mechanism. `replica identity full` on `task_assignees` plus Supabase's non-RLS-filtering of DELETE events still puts the full old row (incl. `assigned_by`) on the wire to every authenticated subscriber. The composite PK `(task_id,user_id)` already supplies both columns the DELETE handler reads (`use-my-tasks-realtime.ts:173-177`), so `replica identity full` is not load-bearing. Nothing verifies `lib/supabase/client.ts` carries the user JWT into the Realtime socket (bare `createBrowserClient`, no `realtime.setAuth`). |
| AS-019 | PASS | `reconcile-realtime-task.ts:133-134,193-194` removes the stale placement and re-buckets under the new `due_date`. Mutation (skip stale-placement removal) kills `f009 > "moves a task to its new date bucket…"` and `f027 > test_AS_019_UPDATE_changing_due_date_moves_the_task_to_the_new_day` — the latter renders the real component and asserts DOM movement between day cells. |
| AS-020 | **PASS (was blocker) — with a major caveat** | `reconcile-realtime-task.ts:157` now reads `isDone: isDoneStatus(row.status)` — the stale `existing.statusCategory` is gone. **Mutation MUT-D** (restore the second argument) → 2 failures in `f034-fix-realtime-bugs.test.ts`. Crucially the fixture at `f034:121` is now `statusCategory: "in_progress"` (a representative production value), which is what makes the mutation lethal. Caveat (major, tracked separately below): `isDoneStatus(status)` with no category falls back to `status === "done"`, which contradicts the F222 rule stated in `status-category.ts:1-9` — a workspace whose done column is renamed "Shipped" (category `done`) yields `isDone: false`. Effect is cosmetic only (`day-cell.tsx:151` strike-through) and self-corrects on next server fetch, and placement — the literal wording of AS-020 — is unaffected. Not a blocker. |
| AS-021 | PASS | `reconcile-realtime-task.ts:124-127` (`!row.due_date` → remove) plus `:91-111` DELETE. Mutation replacing the `!row.due_date` branch with `return byDate` kills 2 tests including the DOM-level `f027 > test_AS_021_…`. |
| AS-022 | FAIL (major) | Unchanged in substance. `subscribe-calendar-realtime.ts:71-77` still passes **no server-side filter**, so every calendar client receives a notification for every `tasks` row change it is entitled to see across *all* its workspaces, and DELETE notifications for rows RLS would otherwise hide. The assertion says *delivers*; enforcement is a client-side `visibleProjectIds` gate (`reconcile-realtime-task.ts:118`) plus a local-presence gate for DELETE (`:107-110`). Positive change: the f009 test no longer **pins the absence** of a filter (`f009:53-73` asserts channel/event/schema/table only, and both `table→"comments"` and `event→"INSERT"` mutations kill it), so the real fix can now land without breaking the suite. |
| AS-023 | PASS | Unchanged from #3/#4 and still mutation-killed. `palette-search-realtime.test.ts:331-383` fires the realtime event, resolves a mocked `searchPalette` carrying the stale title, and asserts the new title survives. |
| AS-024 | FAIL (major, downgraded from blocker) | The **merge** side is now genuinely defended: `applyRealtimePatches`, `isTombstone` and `RealtimeTaskPatch` are `export`ed from `command-palette.tsx:84-88` and imported by `f034-fix-realtime-bugs.test.ts:23-27`; **MUT-B** (`isTombstone → return false`) now KILLS `test_AS_024_stale_search_response_does_not_resurrect_a_realtime_deleted_task`. Scrutiny-4's M4 survivor is dead. The production gaps flagged in #4 are also genuinely closed in source: the tombstone is written unconditionally from the **event** (`use-palette-search-realtime.ts:90-107` → `command-palette.tsx:356`), not from a results diff, and `navigate()` (`:376`), the action branch (`:444`) and the Cmd+K toggle (`:186-193`) all call the new shared `resetPaletteState()` (`:233-243`). **But none of that wiring is tested.** `grep -rn "onDeletedTaskId\|handleTaskDeleted\|resetPaletteState" tests/` returns zero hits in any palette test. Two mutations SURVIVED (below): deleting the hook's tombstone-emit calls, and removing `resetPaletteState()` from `navigate()`. The AS-024 test builds its patch map by hand (`f034:219 patches.set("t1", {_deleted:true})`), so it proves the filter works given a tombstone, never that a DELETE event produces one. |

### Severity

- **Blockers**: none. All three scrutiny-4 blockers (AS-016, AS-020, AS-024) are cleared at the source level.
- **Major**: AS-018 (delivery-level authz), AS-022 (unscoped delivery + no server filter), AS-024 (tombstone-write and close-path resets untested; two surviving mutations).
- **Minor/latent**: renamed-done-column degradation on AS-020; stale `statusCategory` carried by `...existing`; invalid `"todo"` category fixtures; untested restore-from-trash tombstone clearing.
- **Unresolved-unknown**: AS-015, AS-017 (deployment state of the publication migration).

---

## Mutation battery

Run in a detached worktree at `f6dcaae`. Note: `tests/unit/fts-tasks.test.ts`
fails to collect in a bare worktree (`Error: supabaseUrl is required` — needs
`.env`); that file is green in the working tree. Worktree baseline is therefore
192 files / 1487 tests; working-tree baseline is 193 / 1490.

| # | Mutation | Result |
|---|---|---|
| MUT-A | `use-palette-search-realtime.ts` — stub out both `onDeletedTaskId(...)` calls (lines 98, 105) | **SURVIVED** — 1487 passed. Tombstone-write path has zero coverage. |
| MUT-B | `command-palette.tsx:89` `isTombstone` → `return false` | **KILLED** — `test_AS_024_stale_search_response_does_not_resurrect_a_realtime_deleted_task` fails. (Survived in #4.) |
| MUT-C | `personal-todo-list.tsx:67` → `initialTaskIds: initialTodos.map(t => t.id)` | **KILLED** — 2 failures (AS-016, AS-018 wiring tests). |
| MUT-D | `reconcile-realtime-task.ts:157` → `isDoneStatus(row.status, existing.statusCategory)` | **KILLED** — 2 failures in `f034-fix-realtime-bugs.test.ts`. (Survived as a fixture-hidden bug in #4.) |
| MUT-E | `command-palette.tsx:376` — remove `resetPaletteState()` from `navigate()` | **SURVIVED** — 1487 passed. No close path other than Escape is covered. |
| MUT-F | `reconcile-realtime-task.ts` — skip stale-placement removal on due-date change | KILLED — 2 failures (AS-019). |
| MUT-G | `reconcile-realtime-task.ts` — `!row.due_date` branch → `return byDate` | KILLED — 2 failures (AS-021). |
| MUT-H | `subscribe-calendar-realtime.ts` — `table: "tasks"` → `"comments"`; separately `event: "*"` → `"INSERT"` | KILLED each — the loosened f009 test is not vacuous. |
| MUT-I | delete `20260831000001_task_assignees_realtime_publication.sql` | **SURVIVED** (carried from #3/#4, still unguarded). |
| MUT-J | `my-tasks/page.tsx:141,194` → `initialTaskIds={[]}` | **SURVIVED** — the *page's* threading of real ids has no test; only the component/hook contract does. Low severity (correct by inspection) but it is the exact layer that was wrong in F032. |
| MUT-K | fixture todo id `"todo-1"` → `"task-1"` **plus** MUT-C | all 7 pass again — confirming the distinct-id fixture is load-bearing and that an id collision would mask the bug exactly as it did in round 4. |

---

## Tests that pass but do not fully defend their assertion

1. `personal-todo-list-realtime-wiring.test.tsx:153-173` (AS-016) — the DOM
   assertion is `getByText("Second reminder (arrived live)")`, a **personal
   to-do** string produced by the harness's own `refresh.mockImplementation`
   (`:116`). It proves the tracked-id gate admits a real task id and that
   `router.refresh()` fires; it does not prove a My Tasks **task** row shows
   the new status. That hop is server-rendered and unreachable from a unit
   test — it must be covered by the UX validator, not papered over here.
2. `f034-fix-realtime-bugs.test.ts:214-232` (AS-024) — now imports the real
   merge function, but seeds `patches` by hand. The event → tombstone edge is
   untested (MUT-A survives).
3. `command-palette-shell.test.tsx:80` — still covers only the Escape close
   path. `navigate()`, the action branch and the Cmd+K toggle are untested
   (MUT-E survives).
4. `f009-calendar-realtime-subscription.test.ts:129` and
   `f027-calendar-realtime-wiring.test.tsx:85` — `statusCategory: "todo"` is
   not a member of `StatusCategory` (`not_started | in_progress | done`); it
   compiles only because `CalendarTask.statusCategory` is widened to
   `string | null` (`lib/queries/calendar.ts:71`). Should be `"not_started"`.
5. `lib/tasks/reconcile-my-tasks-realtime-task.ts` — still **zero production
   callers** after five rounds, still keyed off the deprecated `assignee_id`.
   Its 10 green tests validate an obsolete data model.
6. `reconcile-realtime-task.ts:120-122` — the `row.deleted_at` branch remains
   dead in production: `tasks_select_active_members` is
   `deleted_at is null and …`, so a soft-delete UPDATE fails RLS and is never
   broadcast. Both covering tests fabricate payloads Supabase will not send.

---

## Additional defects (not directly assertion-blocking)

- **`statusCategory` is never patched** on the calendar UPDATE branch
  (`reconcile-realtime-task.ts:137` `...existing`), leaving objects internally
  inconsistent (`status:"done"`, `isDone:true`, `statusCategory:"in_progress"`).
  No current calendar consumer reads it, but the codebase convention
  (`task-list-table.tsx:388` calls `isOverdue(..., task.statusCategory)`)
  makes this a latent trap. Setting `statusCategory: null` on the UPDATE
  branch — matching the INSERT branch at `:176` — would at least make the
  degraded path self-consistent.
- **Restore-from-trash** does not clear a tombstone. Mitigated (not fixed) by
  `command-palette.tsx:271`, which clears the whole patch map on query change,
  so suppression lasts only until the query changes or the palette closes.
- **Calendar stale closure** — `use-calendar-realtime.ts:35-47` has deps
  `[workspaceId]` only; the subscribed callback is captured on first mount, so
  a later `projectIds` change (filter change, month nav) is not reflected in
  the client-side gate. Rescued only by the `key={dataKey}` remount in
  `month-grid.tsx`.
- **Silent drops with no telemetry** throughout `use-my-tasks-realtime.ts`
  (`:165,173,192,194,199,201`) — bare `return`s make "no events" and "all
  events discarded" indistinguishable. This is exactly the failure mode that
  hid the AS-016 bug for three rounds.
- **All four `.subscribe()` call sites still discard the status callback.**
  `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` swallowed with no log, toast, retry
  or post-reconnect refetch.
- **Effect dependency churn** — `use-my-tasks-realtime.ts:237-242` depends on
  `initialTaskIds`, and `my-tasks/page.tsx:130` builds a fresh array on every
  server render.
- **Cross-workspace over-delivery** — a user in workspaces A and B viewing A's
  calendar receives all of B's task INSERT/UPDATE events over the wire.
- **Refresh storm unfixed** — `personal-todo-list.tsx:70-73` fires an
  undebounced `router.refresh()` of a 5+ query RSC tree per event.
- **`workspaceId ?? ""`** at `calendar-day-grid.tsx:105` and the **bare
  `catch { return }`** at `use-palette-search-realtime.ts:62-64` carry over.

---

## Recommended follow-up features

**FU-AA — Test the palette tombstone WRITE path and every close-path reset (major, AS-024).**
The merge side of AS-024 is now genuinely defended, but two mutations survive the full suite: stubbing out both `onDeletedTaskId(...)` calls in `lib/hooks/use-palette-search-realtime.ts:98,105`, and deleting `resetPaletteState()` from `navigate()` in `components/command/command-palette.tsx:376`. `grep -rn "onDeletedTaskId\|handleTaskDeleted\|resetPaletteState" tests/` returns zero hits in any palette test, so nothing verifies that a DELETE event ever produces a tombstone or that closing the palette ever clears the map. Add (a) a hook-level test for `usePaletteSearchRealtime` asserting `onDeletedTaskId` fires for a raw `DELETE` payload and for an `UPDATE` carrying a non-null `deleted_at`, including the case where the task was never in `results`; and (b) a component-level test mirroring `palette-search-realtime.test.ts:331` that fires the delete event against the real `CommandPalette`, then resolves a mocked `searchPalette` still containing the task, and asserts it does not reappear. Then add one test per close path (`handleOpenChange`, Cmd+K toggle, `navigate`, the action branch at `:444`) asserting `realtimePatches` is empty on the next open — each must fail if that individual path stops calling the shared reset.

**FU-AB — Resolve the real status category on calendar realtime events (major, AS-020 spirit).**
`reconcile-realtime-task.ts:157` now correctly ignores the stale `existing.statusCategory`, but falls back to `isDoneStatus(row.status)`, which `lib/tasks/status-category.ts:37-40` degrades to a literal `status === "done"` comparison. That directly contradicts the F222 contract stated in that file's own header: a renamed done column ("Shipped", category `done`) yields `isDone: false`, and a column literally named "done" whose category is `in_progress` yields `isDone: true`. The effect is currently cosmetic (`day-cell.tsx:151` / `day-overflow.tsx:65` strike-through) and self-corrects on the next server fetch, hence major rather than blocker. Thread the workspace status-name → category map (already fetched at `calendar/page.tsx:120-124` via `getWorkspaceStatusOptions`) into `CalendarDayGrid` and resolve the **new** status's category on both the INSERT and UPDATE branches, patching `statusCategory` alongside `isDone` so the merged object stops being internally inconsistent. Test fixtures must include a renamed done column; also replace the invalid `statusCategory: "todo"` fixtures at `f009-calendar-realtime-subscription.test.ts:129` and `f027-calendar-realtime-wiring.test.tsx:85` with `"not_started"`.

**FU-U (carried, unchanged) — Scope calendar realtime delivery (major, AS-022).**
`subscribe-calendar-realtime.ts:71-77` still passes no `filter`, so every calendar client receives DELETE notifications for every task row and all INSERT/UPDATE events for every workspace the user belongs to; enforcement is entirely a client-side `visibleProjectIds` gate. The f009 test has been correctly un-pinned by F036, so the fix can now land without breaking the suite. Use the `projectIds` already threaded into `CalendarDayGrid` with `filter: "project_id=in.(...)"`, mirroring `subscribe-board-realtime.ts`, or denormalise `workspace_id` onto `tasks`. While there, fix the stale closure at `use-calendar-realtime.ts:35-47` so a `projectIds` change re-subscribes rather than relying on the `key={dataKey}` remount.

**FU-V (carried, unchanged) — Stop broadcasting full un-assignment rows; verify RLS reaches the socket (major, AS-018).**
Supabase does not apply RLS to DELETE events, and `replica identity full` on `task_assignees` puts the complete old row — including `assigned_by` — on the wire to every authenticated subscriber. The composite PK `(task_id, user_id)` already carries both columns the client reads at `use-my-tasks-realtime.ts:173-177`, so revert to `replica identity default` and add a server-side `filter` on the `task_assignees` subscription. Separately, `lib/supabase/client.ts` is a bare `createBrowserClient` with no `realtime.setAuth`, and nothing verifies the socket carries the user JWT — every AS-018 test today proves only the client-side id gate.

**FU-W (carried, unchanged) — Guard publication membership and confirm deployment (AS-015/AS-017).**
Deleting `20260831000001_task_assignees_realtime_publication.sql` still leaves the suite green (MUT-I, survived in three consecutive rounds), so the root cause found in #2 is fixed in SQL and protected by nothing. Add a test asserting `public.task_assignees` and `public.tasks` are members of the `supabase_realtime` publication — ideally by querying `pg_publication_tables` against a local instance, at minimum by asserting migration content — and record in the repo that the migration has been applied to the linked project. Until this exists AS-015 and AS-017 cannot leave INCONCLUSIVE.

**FU-X (carried) — Handle soft-deleted tasks on the calendar (major).**
`reconcile-realtime-task.ts:120-122` handles `row.deleted_at`, but `tasks_select_active_members` is `deleted_at is null and is_project_visible_to(project_id)`, so an UPDATE setting `deleted_at` produces a NEW row that fails RLS and is never broadcast. The branch is dead code and a task another user soft-deletes stays on the calendar until manual refresh. Either surface soft-deletes through a channel the subscriber can receive, or document the limitation and delete the two tests that fabricate payloads Supabase will not send.

**FU-Y (carried) — Surface subscription failure, debounce refreshes, delete dead code (minor).**
Every `.subscribe()` call site discards its status callback, so `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` degrade silently to "no live updates" — the exact failure class that hid the F028 publication gap. Log the status and refetch on re-`SUBSCRIBED`. Add logging to the silent `return`s in `use-my-tasks-realtime.ts` (`:165,173,192,194,199,201`). Add a trailing-edge debounce (~250ms) around `personal-todo-list.tsx:70-73`, and memoise `allTaskIds` so the hook's effect does not churn. Finally, delete `lib/tasks/reconcile-my-tasks-realtime-task.ts` and its 10 tests — five rounds with no production caller, keyed off the deprecated `assignee_id`.

**FU-AD — Cover the page-level threading of `initialTaskIds` (minor, AS-016).**
Mutation MUT-J — replacing `initialTaskIds={allTaskIds}` with `initialTaskIds={[]}` at both `app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx:141` and `:194` — leaves the entire suite green. The component/hook contract is well tested, but the page's construction of `allTaskIds` from `realBuckets` is not covered anywhere, and the page is precisely the layer that was wrong in F032. Add a test asserting the My Tasks page passes a non-empty `initialTaskIds` derived from the `getMyTasks` result, covering both the empty-state and populated render branches. Separately, note the tracked set is monotonic (`use-my-tasks-realtime.ts:229-242` only ever `Set.add`s), so a task that leaves the user's list without a `task_assignees` DELETE — revoked project membership, or the `?watched=1` toggle turned off — keeps triggering spurious `router.refresh()` calls. No data exposure (the refresh re-reads through RLS), but worth pruning.

**FU-AC — Cover the AS-016 last hop in the UX validator (process, not code).**
No unit test can prove "the My Tasks row updates live", because the row is server-rendered and the client only calls `router.refresh()`. The wiring test asserts a personal-todo string emitted by its own refresh mock, which is the strongest thing achievable at that layer. Rather than adding more unit theatre, add an explicit UX-validator step: with two sessions open, change a task's status as user B and assert user A's My Tasks row reflects the new status without a manual reload. The same applies to AS-015 and AS-017, which are INCONCLUSIVE for the related reason that no test can observe the Postgres publication.

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

All 13 are pre-existing and unchanged from scrutiny #4. No new lint errors.

### Unit tests (working tree, HEAD = f6dcaae)

```
$ npx vitest run tests/unit

 Test Files  193 passed (193)
      Tests  1490 passed (1490)
   Duration  38.35s
```

(+1 test vs. scrutiny #4's 1489 — the net effect of F035/F036/F037's test churn.)

### Mutation battery summary (detached worktree at f6dcaae)

```
worktree baseline                                  192 files / 1487 tests passed
                                                   (fts-tasks.test.ts needs .env; env artifact)
MUT-A  hook onDeletedTaskId calls stubbed          1487 passed              SURVIVED  <-- new major
MUT-B  isTombstone -> return false                 1 failed | 16 passed     KILLED    (survived in #4)
MUT-C  initialTaskIds -> initialTodos ids          2 failed | 5 passed      KILLED
MUT-D  isDoneStatus(row.status, existing.status..) 2 failed | 27 passed     KILLED    (survived in #4)
MUT-E  navigate() reset removed                    1487 passed              SURVIVED  <-- new major
MUT-F  skip stale-placement removal (AS-019)       2 failed                 KILLED
MUT-G  !row.due_date branch neutered (AS-021)      2 failed                 KILLED
MUT-H  subscribe table->comments / event->INSERT   killed each              KILLED
MUT-I  publication migration file deleted          all green                SURVIVED  (carried)
MUT-J  page.tsx initialTaskIds={[]}                 all green                SURVIVED  <-- new minor
MUT-K  fixture id collision + MUT-C                 7 passed                 (confirms fixture is load-bearing)
```
