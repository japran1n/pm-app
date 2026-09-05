# M2 — Realtime expansion — Scrutiny report #3

HEAD reviewed: `0fd90c4`. Fix commits since scrutiny #2: `d0d832b` (F028),
`0fc8f2b` (F029), `cd92a07` (F031), `0fd90c4` (F030).

Scope note: mobile `AgendaList` is excluded per the milestone brief. AS-019 /
AS-020 / AS-021 are judged on the desktop calendar grid only.

Verdict: **FAIL — milestone rejected.**
Score: **3 PASS / 5 FAIL / 2 INCONCLUSIVE — 2 blockers, 3 major.**

Real progress this round. Three of the four fixes are genuine and
mutation-confirmed: the palette `.subscribe()` gap is closed, the AS-023
clobber race is closed with a discriminating regression test, and the
calendar desktop paths are behaviourally tested. But **F031 introduced a new
regression that breaks AS-016 in production**, and the test suite actively
enforces the broken behaviour.

---

## Assertion results

| ID | Result | Reason |
|----|--------|--------|
| AS-015 | INCONCLUSIVE | Migration is correct, guarded and correctly ordered; client path (`onAssigned` → `router.refresh()` → server refetch) genuinely surfaces the task. But there is **no evidence the migration was applied** to the linked project, and **deleting the migration file leaves the suite green** — the exact root cause of scrutiny #2 remains undefended by any test. |
| AS-016 | **FAIL (blocker)** | **New regression from `cd92a07`.** `use-my-tasks-realtime.ts:194` drops any `tasks` UPDATE whose id is not in `trackedTaskIdsRef`, and `initialTaskIds` **has zero production callers** — `personal-todo-list.tsx:45-51` never passes it. On a fresh page load the tracked set is empty, so a status change by another user on any server-rendered My Tasks row is discarded and the row never updates. |
| AS-017 | INCONCLUSIVE | Same as AS-015: publication membership unverified against the DB and untested. Under the composite PK `(task_id, user_id)`, DEFAULT replica identity already carried `user_id`; `replica identity full` was unnecessary and is net-negative (see AS-018). |
| AS-018 | FAIL (major) | The tracked-id filter is a **relevance** filter applied after the payload reaches the browser, not an authorization mechanism. Worse, `20260831000001…sql:41` sets `replica identity full` on `task_assignees`, and Supabase does not RLS-filter DELETE events — so every authenticated subscriber now receives the **full old row** (incl. `assigned_by`) for every un-assignment in the database, including tasks in projects they cannot see. Scrutiny #2's leak was widened, not closed. |
| AS-019 | PASS | Desktop grid moves the chip between day cells; `f027-calendar-realtime-wiring.test.tsx:166` renders the real component and asserts DOM movement. Caveat: `use-calendar-realtime.ts:35-47` freezes `visibleProjectIds` at mount (see Additional defects). |
| AS-020 | FAIL (major) | The chip appears on the correct day, but (a) `isDone` uses a literal `status === "done"` fallback (`lib/tasks/status-category.ts`), so any renamed done column (`Done`, `Shipped`) renders as not-done — the exact string-vs-category anti-pattern F222 exists to prevent; (b) the UPDATE merge branch (`reconcile-realtime-task.ts:136-144`) never re-derives `isDone`, so moving a task into a done column leaves it styled as open indefinitely; (c) active URL filters are still not honoured, so a calendar filtered to `priority=urgent` gains tasks the server query deliberately excluded. Fixtures only ever use `"done"`/`"todo"`, so the tests bless the bug. |
| AS-021 | PASS | Both the due-date-clear and DELETE paths are covered behaviourally (`f027:187`, `f027:204`), and the DELETE fixtures at `f009:333-375` now use the realistic `old: { id }` shape. |
| AS-022 | **FAIL (blocker)** | The local-state check is a **rendering** guard, not a **delivery** guard, and the assertion says *delivers*. There is still no server-side `filter` on the calendar subscription, so every calendar client receives the primary key of every task deleted anywhere in the database. The board already demonstrates the workable pattern (`project_id=eq.…`), and `projectIds` is already threaded to `calendar-day-grid.tsx:78`. All three "AS-022" tests assert channel topic strings or client reconciler behaviour; none would fail if delivery scoping regressed. |
| AS-023 | PASS | Genuinely fixed and mutation-killed. `palette-search-realtime.test.ts:331-383` fires the realtime event, then resolves a mocked `searchPalette` carrying the stale title, and asserts the new title survives. Neutering `applyRealtimePatches` turns the suite red. |
| AS-024 | FAIL (major) | `.subscribe()` is now genuinely asserted (`palette-search-realtime.test.ts:149-157`; mutation confirmed). But F030 fixed only the title half of the clobber race: on a removal, `command-palette.tsx:300-304` **deletes** the id from the patch map instead of recording a tombstone, so a search response resolving after the delete event **resurrects the deleted task**. That is precisely AS-024's failure mode, and no test covers it — the AS-024 test never resolves a search after the delete. |

### Severity

- **Blockers**: AS-016, AS-022.
- **Major**: AS-018, AS-020, AS-024.
- **Unresolved-unknown**: AS-015, AS-017 (deployment state of the migration).

---

## The single most important finding

`grep -rn "initialTaskIds" components lib app tests` returns **seven hits, all
inside `components/my-tasks/use-my-tasks-realtime.ts` itself.**

```
components/my-tasks/use-my-tasks-realtime.ts:84   initialTaskIds?: Iterable<string>;
components/my-tasks/use-my-tasks-realtime.ts:223    initialTaskIds,
components/my-tasks/use-my-tasks-realtime.ts:235    const trackedTaskIdsRef = useRef<Set<string>>(new Set(initialTaskIds ?? []));
...
```

The sole production call site passes no ids:

```tsx
// components/my-tasks/personal-todo-list.tsx:45-51
useMyTasksRealtime({
  userId: currentUserId,
  onAssigned: () => router.refresh(),
  ...
});
```

So `trackedTaskIds` is empty on every page load, and the AS-018 scoping gate
at `use-my-tasks-realtime.ts:194` silently discards status changes for every
task the server rendered. AS-016 worked (bluntly) before `cd92a07` and does
not work now. The hook's own doc comment at lines 79-83 asserts that an empty
default "is safe"; it is not.

The tests hide this by construction: the AS-016 case at
`personal-todo-list-realtime-wiring.test.tsx:149-157` fires a
`task_assignees` INSERT for `t1` **first** to seed the tracked set, then
clears the `refresh` mock. That seeding step is exactly what production never
performs. Minimum fix: thread the already-flattened `realBuckets` task ids
(`my-tasks/page.tsx:107`) through a new `initialTaskIds` prop.

---

## Mutation testing

Run in a detached worktree at `0fd90c4`. Baseline: 192/192 files, 1483/1483 green.

| Mutation | Result |
|---|---|
| M1 `applyRealtimePatches` returns `results` verbatim (AS-023 clobber fix neutered) | **KILLED** (1 test failed) |
| M2 delete `.subscribe()` from `lib/palette/subscribe-palette-search-realtime.ts` | **KILLED** (scrutiny #2's surviving M10 is now closed) |
| M3 remove the `trackedTaskIds.has(row.id)` UPDATE gate | **KILLED** — and this is the problem: the suite *enforces* the gate that breaks AS-016 in production |
| M4 delete `20260831000001_task_assignees_realtime_publication.sql` entirely | **SURVIVED** (no test references `supabase_realtime`) |

M4 is the important survivor. The root cause identified in scrutiny #2 has
been fixed in SQL but is protected by nothing — the next schema refactor can
silently drop publication membership with the full suite green.

M3 is the important *kill*: a mutation that KILLS is normally reassuring, but
here the surviving assertions encode the mechanism (id tracking) rather than
the assertion (the row updates live), so they lock in the regression.

---

## Tests that pass but do not defend their assertion

1. `personal-todo-list-realtime-wiring.test.tsx:103` still asserts
   `getByText("Second reminder (arrived live)")` — a **personal to-do**
   string. `PersonalTodoList` renders no task rows at all. The harness
   (lines 110-116) hand-wires `refresh.mockImplementation(() => setTodos(...))`
   and then asserts its own mock ran. Nothing anywhere asserts a My Tasks
   **task** row re-renders with a new status. (The hook is no longer mocked —
   that part of scrutiny #2 is fixed.)
2. `f008-my-tasks-realtime.test.ts` AS-016/AS-018 cases pre-seed the tracked
   set via a `task_assignees` INSERT, encoding the mechanism and making the
   production gap invisible.
3. `f009-calendar-realtime-subscription.test.ts:309/333` and `f027:222` assert
   channel **topic strings** for AS-022 — the subscribe module's own comment
   states the topic is "purely local dedup/ref-count key… does not need to
   correspond to a real Postgres filter". Zero security meaning.
4. Calendar `isDone` tests (`f009:379`, `f009:397`) use only `status: "done"` /
   `"todo"` — the two cases the literal comparison happens to get right.
5. `f009:235-251` and `f027:204-220` still fabricate `old: { id, project_id }`
   for DELETE, a shape production cannot emit (`tasks` has no
   `replica identity full`). Harmless now that the field is unread, but it is
   the fixture that let the inert gate look tested.
6. `lib/tasks/reconcile-my-tasks-realtime-task.ts` still has **zero production
   callers** and still keys off the deprecated `assignee_id` (lines 48, 57).
   Its 10 green tests mirror a schema that no longer exists; wired up as-is,
   line 57 would evict every task from the list.
7. `reconcile-palette-search-results.ts:49-60` — the `eventType === "DELETE"`
   branch is unreachable under this app's soft-delete-only `deleteTask`; the
   test file's own comment admits it is "effectively dead code".

---

## Additional defects (not directly assertion-blocking)

- **Palette state is not reset on the common close paths.** `handleOpenChange`
  (`command-palette.tsx:192`) is the only place query/results/loading/patch-map
  are cleared, but `navigate()` (`:320`) and the Cmd+K toggle (`:162`) call
  `setOpen(false)` directly on a controlled Radix `Dialog`, which does not
  invoke `onOpenChange` for a programmatic prop change. Selecting any result
  leaves the query, results and the entire patch map stale into the next open.
  The comment at `:185-191` asserting the opposite is false.
- **Stale patch permanence.** `reconcilePaletteSearchResults` no-ops when a task
  is absent from current results, so a rename-back that occurs while the task
  is out of view is never recorded. Any later search response containing that
  task is overwritten with the stale title for the rest of the session.
- **Calendar stale closure.** `use-calendar-realtime.ts:35-47` deps are
  `[workspaceId]` with `exhaustive-deps` disabled, freezing `visibleProjectIds`
  at mount. Rescued only by the `key={dataKey}` remount in `month-grid.tsx`;
  removing that plausible-looking line silently drops INSERTs for projects
  created after mount.
- **All four `.subscribe()` call sites still discard the status callback.**
  `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` are swallowed with no log, toast,
  retry or post-reconnect refetch. This is the failure class the F028 migration
  addresses, and it is by construction invisible at runtime.
- **Refresh storm unfixed.** `personal-todo-list.tsx:47-50` fires an undebounced
  `router.refresh()` of a 5+ query RSC tree per event, re-entering the
  `pendingToggles` race guard each time.
- **Chip ordering.** Calendar INSERT/move appends `[...list, task]` regardless
  of `getCalendarTasks` ordering, so a realtime-moved chip can land in the
  `+N more` overflow where a refresh would show it inline.
- **`workspaceId ?? ""`** at `calendar-day-grid.tsx:105` silently disables
  realtime entirely when the prop is missing, with no dev warning.
- **Bare `catch { return }`** at `lib/hooks/use-palette-search-realtime.ts:62-64`
  still silently disables all palette realtime on client-construction failure.
- **Dead branches** in `command-palette.tsx`: the `!previous` branch at `:291`
  and the non-function `update` branch at `:279-283` are both unreachable.

---

## Recommended follow-up features

**FU-J — Seed `initialTaskIds` from the server-rendered My Tasks list (blocker, AS-016).**
`useMyTasksRealtime`'s `initialTaskIds` parameter has no production caller, so the AS-018 scoping gate added in `cd92a07` discards every `tasks` UPDATE on a freshly loaded page and AS-016 is broken in production. Add an `initialTaskIds` prop to `PersonalTodoList` and pass the flattened task ids that `my-tasks/page.tsx:107` already computes from `realBuckets`, threading them into the hook at both the empty-state and populated render branches. The accompanying test must render a component that actually displays My Tasks **task** rows (not personal to-dos), mount it with server-supplied tasks and **no** prior `task_assignees` INSERT, dispatch a `tasks` UPDATE changing the status, and assert the status cell changed — that test fails today, which is exactly why it must exist. Delete or rewrite the existing seeding step in `personal-todo-list-realtime-wiring.test.tsx:149-157`, which currently hides the bug.

**FU-K — Scope calendar realtime delivery server-side (blocker, AS-022).**
The calendar subscribes with no `filter`, so every client receives every `tasks` row event in the database; the new local-state DELETE check suppresses the visible symptom but the assertion is about delivery, not rendering. Add a server-side `filter: "project_id=in.(<visible ids>)"` using the `projectIds` already threaded into `CalendarDayGrid`, mirroring the pattern `subscribeToBoardRealtime` already uses, or denormalise `workspace_id` onto `tasks` and filter on that. Replace the three topic-string assertions with a test that inspects the `filter` argument actually passed to `.on()` and fails if it is absent or does not constrain to the visible project set.

**FU-L — Close the AS-024 resurrection race (major).**
`command-palette.tsx:300-304` deletes a task's entry from the realtime patch map when the task is removed from results, so a `searchPalette` response resolving after the delete event re-adds the deleted task — the same clobber race F030 fixed for titles, left open for deletions. Replace the delete with a tombstone (e.g. a `removedIds` set on the same ref) and have `applyRealtimePatches` filter tombstoned ids out of every incoming search response. Cover it with a test that mirrors the existing AS-023 test at `palette-search-realtime.test.ts:331`: fire the delete event, then resolve a mocked search that still contains the task, and assert it does not reappear.

**FU-M — Guard publication membership with a test, and verify deployment (blocker for confidence, AS-015/AS-017).**
Deleting `20260831000001_task_assignees_realtime_publication.sql` leaves the full suite green, so the root cause identified in scrutiny #2 is fixed but entirely unprotected. Add a test that asserts `public.task_assignees` and `public.tasks` are members of the `supabase_realtime` publication — ideally by querying `pg_publication_tables` against a local/emulated instance, at minimum by asserting migration content. Separately, confirm the migration has actually been applied to the linked project (nothing in the repo records this) and reconsider the `replica identity full` line: the composite PK `(task_id, user_id)` already supplies `user_id` in DELETE old-records, so it buys nothing the client reads while widening an un-RLS-filtered broadcast (see FU-N).

**FU-N — Stop broadcasting full un-assignment rows to unauthorized subscribers (major, AS-018).**
Supabase does not apply RLS to DELETE events, and `replica identity full` on `task_assignees` now puts the complete old row — including `assigned_by` — on the wire to every authenticated subscriber for every un-assignment in the database. Revert to `replica identity default` (the PK already carries both columns the client reads at `use-my-tasks-realtime.ts:173-177`), and add a server-side `filter` on the `task_assignees` subscription so foreign rows stop crossing the wire at all. Add a test asserting the subscription is scoped and that the client-side `user_id` check is a second line of defence rather than the only one.

**FU-O — Correct calendar chip status derivation and honour active filters (major, AS-020).**
`isDone` is derived via a literal `status === "done"` fallback, so a renamed done column (`Done`, `Shipped`, or any `status_templates` item in category `done`) renders as not-done; the UPDATE merge branch at `reconcile-realtime-task.ts:136-144` never re-derives `isDone` or `statusCategory` at all, so moving a task into a done column leaves it permanently styled as open. Thread the workspace status name→category map into `CalendarDayGrid` and resolve the category properly on both INSERT and UPDATE, and pass `{id, name, key}` objects instead of bare `projectIds` so `projectName`/`projectKey` resolve for free. Separately, thread the resolved `CalendarTaskFilters` from `calendar/page.tsx` (the same path `dataKey` already travels) into the reconciler and drop events that do not match the active `status`/`priority`/`assigneeId`/`projectId` filters. Test fixtures must include a renamed done column, which today's `"done"`/`"todo"`-only fixtures do not.

**FU-P — Reset palette state on all close paths (major).**
`navigate()` (`command-palette.tsx:320`) and the Cmd+K toggle (`:162`) call `setOpen(false)` directly on a controlled Radix `Dialog`, which does not fire `onOpenChange`, so the query, results, loading flag and the entire realtime patch map survive into the next palette session — meaning stale titles from a previous session can be re-applied to unrelated search results. Route every close through `handleOpenChange`, or move the reset into an effect keyed on `open`. Correct the false comment at `:185-191`. Also add invalidation so a patch is dropped once it can no longer be trusted against server truth, and delete the unreachable `!previous` branch at `:291` and the dead `DELETE` branch at `reconcile-palette-search-results.ts:49-60`.

**FU-Q — Surface and recover from subscription failure; debounce refreshes (minor, all surfaces).**
Every `.subscribe()` call site discards its status callback, so `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` degrade silently to "no live updates" with zero signal — the exact failure mode the F028 publication gap produced, and the reason it went undetected for two scrutiny rounds. Handle the status callback with at minimum a logged warning, and issue a `router.refresh()`/refetch on re-`SUBSCRIBED` so events missed during a socket drop are recovered. Add a trailing-edge debounce (~250ms) around `personal-todo-list.tsx:47-50`'s four `router.refresh()` calls. Fix the `visibleProjectIds` stale closure in `use-calendar-realtime.ts:35-47` (use a ref or a stable dep) so the calendar no longer depends on the `key={dataKey}` remount for correctness. Finally, either wire `lib/tasks/reconcile-my-tasks-realtime-task.ts` up after correcting it off the deprecated `assignee_id`, or delete it and its 10 tests — it has had no production callers for three scrutiny rounds.

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
   22:26  warning  'SmilePlus' is defined but never used   @typescript-eslint/no-unused-vars
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

All 13 are pre-existing. No new lint errors from M2.

### Unit tests (working tree, HEAD = 0fd90c4)

```
$ npx vitest run tests/unit

 Test Files  192 passed (192)
      Tests  1483 passed (1483)
   Duration  33.66s
```

### Mutation battery (detached worktree at 0fd90c4)

```
baseline                                        192 files / 1483 tests passed
M1 applyRealtimePatches neutered                1 failed | 1482 passed   KILLED
M2 .subscribe() deleted (palette)               1 failed | 10 passed     KILLED
M3 trackedTaskIds UPDATE gate removed           2 failed | 19 passed     KILLED
M4 publication migration file deleted           all green                SURVIVED
```
