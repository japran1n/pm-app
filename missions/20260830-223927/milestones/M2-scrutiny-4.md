# M2 — Realtime expansion — Scrutiny report #4

HEAD reviewed: `459a12c`. Fix commits since scrutiny #3: `dde1945` (F032),
`fc81c0a` (F033), `459a12c` (F034).

Scope note: mobile `AgendaList` is excluded per the milestone brief. AS-019 /
AS-020 / AS-021 are judged on the desktop calendar grid only.

Verdict: **FAIL — milestone rejected.**
Score: **3 PASS / 5 FAIL / 2 INCONCLUSIVE — 3 blockers, 2 major.**

The headline finding: **two of the three claimed fixes do not work, and the
third is defended only by a tautological test.** All three were verified by
mutation, not by reading. The suite is green at 1489/1489 because each new
test was written against a fixture shape that routes around the bug it
claims to cover.

| Claimed fix | Reality |
|---|---|
| F032 — `initialTaskIds` wired (AS-016) | Passes **personal-todo ids** into a **task**-id set. Cross-entity type confusion; the tracked set still never contains a real task id at mount. |
| F034 — `isDone` re-derived on UPDATE (AS-020) | Passes the **stale** `existing.statusCategory`, which makes `isDoneStatus` ignore the new status entirely. The bug was relocated, not fixed. |
| F034 — palette tombstone (AS-024) | Source change is real, but its test re-implements the logic inside the test file and imports nothing from the component. It cannot fail. |
| F033 — AS-022 behavioural DELETE test | Genuine improvement. Still tests **rendering**, not **delivery**, which is what the assertion says. |

---

## Assertion results

| ID | Result | Reason |
|----|--------|--------|
| AS-015 | INCONCLUSIVE | Client path (`task_assignees` INSERT filtered on `user_id` → `router.refresh()`) is correct, and the publication migration exists and is correctly ordered. Unchanged from #3: no evidence the migration was applied to the linked project, and deleting the migration file still leaves the suite green. Not verifiable without a live database. |
| AS-016 | **FAIL (blocker)** | F032 is a **fake fix**. `personal-todo-list.tsx:52` passes `initialTodos.map(t => t.id)` — `initialTodos` is `PersonalTodo[]` from the **`personal_todos`** table (`lib/queries/personal-todos.ts:10-15`), a private sticky-note entity that is not a task. Those ids can never equal a `tasks.id`, so the AS-018 gate at `use-my-tasks-realtime.ts:194` still discards every `tasks` UPDATE on a freshly loaded page. Mutation-verified below. |
| AS-017 | INCONCLUSIVE | Same deployment-state gap as AS-015. Note the migration's `replica identity full` on `task_assignees` is **not load-bearing**: the composite PK `(task_id, user_id)` already supplies both columns the DELETE handler reads (`use-my-tasks-realtime.ts:173-177`). No test fails if it is removed. |
| AS-018 | FAIL (major) | The tracked-id gate is a **relevance** filter applied after the payload reaches the browser, not an authorization mechanism, and F034 added coverage for the client-side `user_id` check only. Unchanged from #3: `replica identity full` on `task_assignees` plus Supabase's non-RLS-filtering of DELETE events puts the **full old row** (incl. `assigned_by`) on the wire to every authenticated subscriber for every un-assignment in the database. Nothing verifies the browser client carries the user JWT into the Realtime socket (`lib/supabase/client.ts` is a bare `createBrowserClient`, no `realtime.setAuth`). |
| AS-019 | PASS | `reconcile-realtime-task.ts:133-188` removes the stale placement and re-inserts at the new `due_date`, merging onto the existing task so joined fields survive. `f027-calendar-realtime-wiring.test.tsx:161-180` renders the real component and asserts DOM movement between day cells. |
| AS-020 | **FAIL (blocker)** | F034 **inverted** the bug rather than fixing it. `reconcile-realtime-task.ts:151` calls `isDoneStatus(row.status, existing.statusCategory)`, and `status-category.ts:37-39` returns `isDoneCategory(category)` — **ignoring `row.status` entirely** — whenever a category is passed. `existing.statusCategory` is the category resolved at initial server fetch, i.e. the task's **old** status. So moving a task into a done column computes `isDoneCategory("in_progress") === false`; moving it out keeps `isDone: true` forever. `statusCategory` is itself never patched (`...existing` at :137), so staleness compounds. Mutation-verified below. |
| AS-021 | PASS | `reconcile-realtime-task.ts:124-127` (`!row.due_date` → `removeTaskEverywhere`) with DOM proof at `f027:200-213`. |
| AS-022 | FAIL (major) | F033's replacement tests are a real improvement over topic-string assertions, but they verify the **client render guard**, and the assertion says *delivers*. There is still no server-side `filter` on `subscribe-calendar-realtime.ts:71-81`, so every calendar client receives a DELETE notification for every task row in the database. Worse, `f009-calendar-realtime-subscription.test.ts:57-64` asserts `onCalls[0].filter` **equals** the unfiltered object — the test now **pins the absence of scoping**, so adding delivery scoping turns the suite red. |
| AS-023 | PASS | Unchanged from #3 and still mutation-killed. `palette-search-realtime.test.ts:331-383` fires the realtime event, resolves a mocked `searchPalette` carrying the stale title, and asserts the new title survives. |
| AS-024 | **FAIL (blocker)** | The tombstone exists in source (`command-palette.tsx:86-112`), but its test (`f034-fix-realtime-bugs.test.ts:175-218`) **re-implements `applyPatches` inside the test file** and asserts against its own 15-line copy. It imports nothing from the component; gutting `isTombstone` leaves it green (mutation-verified). Three real gaps remain uncovered: (a) the tombstone is recorded only by a results **diff** (`:329-333`), so a delete arriving before the task is in `results` writes no tombstone and the in-flight response resurrects it — the exact race; (b) restore-from-trash never clears the tombstone, permanently suppressing a restored task; (c) `navigate()` (`:349`), the action branch (`:416`) and the Cmd+K toggle (`:186`) call `setOpen(false)` directly on a controlled Radix `Dialog`, which does not fire `onOpenChange`, so the tombstone map survives across palette sessions. |

### Severity

- **Blockers**: AS-016, AS-020, AS-024.
- **Major**: AS-018, AS-022.
- **Unresolved-unknown**: AS-015, AS-017 (deployment state of the migration).

---

## The three decisive mutations

All run in a detached worktree at `459a12c`. Baseline: 193 files / 1489 tests green.

### 1. AS-016 — the fix conflates two entities

```tsx
// components/my-tasks/personal-todo-list.tsx:52
initialTaskIds: initialTodos.map((todo) => todo.id),
```

`initialTodos: PersonalTodo[]` comes from `getPersonalTodos` → `.from("personal_todos")`.
The component's own header comment (`:3-5`) says these are "not a task (no
assignee/status/priority), just a one-line reminder". The My Tasks page
computes the real task ids in `realBuckets`
(`app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx:86`) and renders them at
`:130`/`:182`, but passes only `personalTodos` down. The real ids never reach
the hook.

The test hides this by using a todo id **as** a task id:

```tsx
// tests/unit/personal-todo-list-realtime-wiring.test.tsx:156
new: { id: "todo-1", title: "First reminder", status: "done" },
```

**Mutation:** change that one id to `"task-99"` (a task id that is not a todo id
— i.e. every real task).

```
× AS-016: ... triggers a refresh whose fresh data renders
× AS-018: ... triggers a refresh whose fresh data renders
Tests  2 failed | 5 passed (7)
```

The test only passes because it encodes the implementation's confusion. The
assertion is not met in production.

### 2. AS-020 — the fix ignores the new status

```ts
// lib/tasks/status-category.ts:37-40
if (category !== undefined && category !== null) {
  return isDoneCategory(category);   // <-- `status` is never read
}
return status === "done";
```

`getCalendarTasks` populates `statusCategory` on **every** row
(`lib/queries/calendar.ts:123`), so the non-null branch is the production path.
The F034 fixture sets `statusCategory: null`
(`f034-fix-realtime-bugs.test.ts:105`) — precisely the one input that routes
around the bug into the degraded literal comparison.

**Mutation:** change only the fixture, `statusCategory: null` → `"in_progress"`.
No source change.

```
× test_AS_020_marks_isDone_true_when_an_update_moves_a_tracked_task_to_done
AssertionError: expected false to be true
Tests  1 failed | 4 passed (5)
```

The test is green solely because of an unrepresentative fixture. Passing the
stale category is strictly worse than passing nothing.

### 3. AS-024 — the test cannot fail

`f034-fix-realtime-bugs.test.ts:183-198` defines its own local `applyPatches`
and asserts against it at `:200-217`. The file imports
`subscribeToMyTasksRealtime` and `reconcileCalendarRealtimeEvent` but **nothing
from `command-palette.tsx`**.

**Mutation:** `isTombstone` in `command-palette.tsx:89` → `return false;`
(fully disabling the tombstone).

```
Tests  1486 passed (1486)   — the AS-024 test survives
```

The comment at `:176-181` claiming the test "still fails if the source
regresses to a `.delete(id)`-based implementation" is false; it catches
regressions only in its own copy of the logic.

### Mutation battery summary

| Mutation | Result |
|---|---|
| M1 `personal-todo-list.tsx:52` → `initialTaskIds: []` | KILLED (2) — but the killing tests use a todo id as a task id, so the kill is meaningless |
| M2 wiring test AS-016 id `"todo-1"` → `"task-99"` | **PRODUCTION BUG EXPOSED** — 2 failures |
| M3 f034 fixture `statusCategory: null` → `"in_progress"` | **PRODUCTION BUG EXPOSED** — 1 failure |
| M4 `isTombstone` → `return false` | **SURVIVED** — AS-024 test is tautological |
| M5 delete `20260831000001_task_assignees_realtime_publication.sql` | SURVIVED (carried over from #3, still unguarded) |

---

## Tests that pass but do not defend their assertion

1. `personal-todo-list-realtime-wiring.test.tsx:143-165` — asserts
   `getByText("Second reminder (arrived live)")`, a **personal to-do** string
   produced by the harness's own `refresh.mockImplementation`. It asserts its
   own mock ran. Nothing anywhere asserts a My Tasks **task** row re-renders.
2. `f034-fix-realtime-bugs.test.ts:175-218` (AS-024) — asserts against a
   reimplementation; zero coupling to source.
3. `f034-fix-realtime-bugs.test.ts:105` (AS-020) — `statusCategory: null` is
   the one shape `getCalendarTasks` essentially never produces.
4. `f009-calendar-realtime-subscription.test.ts:57-64` (AS-022) — asserts the
   `.on()` config **equals** the unfiltered object, actively locking out the fix.
5. `f009-calendar-realtime-subscription.test.ts:129` — `statusCategory: "todo"`
   is not a member of `StatusCategory` (`not_started | in_progress | done`);
   it compiles only because the field is typed `string | null`.
6. `command-palette-shell.test.tsx:80` — covers the one close path (Escape)
   that *does* reset state; `navigate()` and the Cmd+K toggle are untested.
7. `lib/tasks/reconcile-my-tasks-realtime-task.ts` — still **zero production
   callers** after four rounds, still keyed off the deprecated `assignee_id`.
   Its 10 green tests validate an obsolete data model.
8. `reconcile-realtime-task.ts:120-122` — the `row.deleted_at` branch is dead
   in production: `tasks_select_active_members` is `deleted_at is null and ...`,
   so a soft-delete UPDATE fails RLS and is never broadcast. Consequence: a
   task another user soft-deletes stays on your calendar until refresh. Both
   covering tests fabricate payloads Supabase will not send.

---

## Additional defects (not directly assertion-blocking)

- **Palette state is not reset on the common close paths** (carried from #3,
  unfixed). Selecting any result leaves query, results and the entire
  patch/tombstone map stale into the next open. The comment at
  `command-palette.tsx:185-191` asserting the opposite is still false.
- **Silent drops with no telemetry** throughout `use-my-tasks-realtime.ts`
  (`:165,173,192,194,199,201`) — bare `return`s make "no events" and "all
  events discarded" indistinguishable. This is exactly the failure mode that
  has hidden the AS-016 bug for two rounds.
- **All four `.subscribe()` call sites still discard the status callback.**
  `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` swallowed with no log, toast, retry
  or post-reconnect refetch.
- **Effect dependency is meaningless.** `use-my-tasks-realtime.ts:237-242`
  depends on `initialTaskIds`, but `personal-todo-list.tsx:52` builds a fresh
  array every render.
- **Calendar stale closure** (`use-calendar-realtime.ts:35-47`) — deps
  `[workspaceId]` with `exhaustive-deps` disabled; rescued only by the
  `key={dataKey}` remount in `month-grid.tsx`.
- **Cross-workspace over-delivery** — a user in workspaces A and B viewing A's
  calendar receives all of B's task INSERT/UPDATE events over the wire.
- **Refresh storm unfixed** — `personal-todo-list.tsx:53-56` fires an
  undebounced `router.refresh()` of a 5+ query RSC tree per event.
- **Chip ordering**, **`workspaceId ?? ""`** at `calendar-day-grid.tsx:105`,
  **bare `catch { return }`** at `use-palette-search-realtime.ts:62-64`, and
  the **dead branches** in `command-palette.tsx` all carry over from #3.

---

## Recommended follow-up features

**FU-R — Thread the real My Tasks task ids into the realtime hook (blocker, AS-016).**
`PersonalTodoList` currently seeds `initialTaskIds` from `initialTodos`, which are `personal_todos` rows, not tasks — so the tracked-id set at mount contains ids that can never match a `tasks.id`, and the AS-018 gate discards every `tasks` UPDATE on a freshly loaded page. Add a distinct prop (e.g. `initialTaskIds: string[]`) to `PersonalTodoList`, populate it in `app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx` by flattening the `realBuckets` task ids already computed at `:86`, and pass it at both the empty-state (`:130`) and populated (`:182`) render sites; leave `initialTodos` for the to-do list alone. The accompanying test must dispatch a `tasks` UPDATE using a **task** id that is not also a todo id, with no prior `task_assignees` INSERT, and assert a My Tasks **task** row (not a personal to-do string) reflects the new status. Rewrite `personal-todo-list-realtime-wiring.test.tsx:156`, which currently uses `"todo-1"` as a task id and is the reason this bug survived a round.

**FU-S — Resolve the true status category on calendar UPDATE (blocker, AS-020).**
`reconcile-realtime-task.ts:151` passes `existing.statusCategory` — the category of the task's *old* status — into `isDoneStatus`, and `status-category.ts:37-39` short-circuits on any non-null category, discarding `row.status` entirely. Because `getCalendarTasks` populates `statusCategory` on every row, this is the production path: moving a task into a done column leaves `isDone: false`, and moving it out leaves it `true` forever, while `statusCategory` itself is never patched so the staleness compounds. Thread the workspace status-name→category map (already fetched at `calendar/page.tsx:120-124` via `getWorkspaceStatusOptions`) into `CalendarDayGrid` and resolve the **new** status's category on both the INSERT and UPDATE branches, patching `statusCategory` alongside `isDone`. As an interim, dropping the second argument on the UPDATE branch is strictly better than passing the stale one. Test fixtures must use a real category value and include a renamed done column ("Shipped", category `done`) — the current `statusCategory: null` fixture is the only input that hides the bug.

**FU-T — Give AS-024 a test that can fail, and close the remaining tombstone gaps (blocker).**
The AS-024 test re-implements `applyRealtimePatches` inside `f034-fix-realtime-bugs.test.ts:183-198` and asserts against that copy, so gutting `isTombstone` in the real component leaves it green. Delete it and write a test that imports the real `CommandPalette`, mirrors the AS-023 structure at `palette-search-realtime.test.ts:331`, fires the delete event, then resolves a mocked `searchPalette` still containing the task, and asserts it does not reappear. Alongside, fix three real gaps the current implementation still has: record the tombstone from the **event** rather than from the results diff (`command-palette.tsx:329-333`), so a delete for a task not yet in `results` still tombstones; clear the tombstone on an UPDATE with `deleted_at === null` so a restored task is not suppressed for the session; and route `navigate()` (`:349`), the action branch (`:416`) and the Cmd+K toggle (`:186`) through `handleOpenChange` so the map does not survive a palette close.

**FU-U — Scope calendar realtime delivery, and stop pinning its absence (major, AS-022).**
`subscribe-calendar-realtime.ts:71-81` passes no `filter`, so every calendar client receives a DELETE notification for every task row in the database and all INSERT/UPDATE events for every workspace the user belongs to. The header comment correctly notes that `tasks` has no `workspace_id` column, so use the `projectIds` already threaded into `CalendarDayGrid` with `filter: "project_id=in.(...)"`, mirroring `subscribe-board-realtime.ts`, or denormalise `workspace_id` onto `tasks`. Critically, `f009-calendar-realtime-subscription.test.ts:57-64` currently asserts the `.on()` config *equals* the unfiltered object — that assertion must be replaced with one that fails when the filter is **absent**, otherwise the fix cannot be landed without breaking the suite.

**FU-V — Stop broadcasting full un-assignment rows; verify RLS reaches the socket (major, AS-018).**
Supabase does not apply RLS to DELETE events, and `replica identity full` on `task_assignees` puts the complete old row — including `assigned_by` — on the wire to every authenticated subscriber for every un-assignment in the database. The composite PK `(task_id, user_id)` already carries both columns the client reads at `use-my-tasks-realtime.ts:173-177`, so revert to `replica identity default` and add a server-side `filter` on the `task_assignees` subscription. Separately, nothing in the repo verifies that the browser client authenticates the Realtime socket — `lib/supabase/client.ts` is a bare `createBrowserClient` with no `realtime.setAuth` — which means every AS-018 test proves only the client-side id gate. Add coverage that the socket carries the user JWT.

**FU-W — Guard publication membership and confirm deployment (blocker for confidence, AS-015/AS-017).**
Carried unchanged from scrutiny #3: deleting `20260831000001_task_assignees_realtime_publication.sql` still leaves the full suite green, so the root cause found in #2 is fixed in SQL and protected by nothing. Add a test asserting `public.task_assignees` and `public.tasks` are members of the `supabase_realtime` publication — ideally by querying `pg_publication_tables` against a local instance, at minimum by asserting migration content — and record somewhere in the repo that the migration has been applied to the linked project.

**FU-X — Handle soft-deleted tasks on the calendar (major).**
`reconcile-realtime-task.ts:120-122` handles `row.deleted_at`, but `tasks_select_active_members` is `deleted_at is null and is_project_visible_to(project_id)`, so an UPDATE setting `deleted_at` produces a NEW row that fails RLS and is never broadcast to the subscriber. The branch is dead code and a task another user soft-deletes stays on the calendar until a manual refresh. Either surface soft-deletes through a channel the subscriber can actually receive, or treat the absence of a broadcast as a known limitation and remove the two tests that fabricate payloads Supabase will not send.

**FU-Y — Surface subscription failure, debounce refreshes, delete dead code (minor, all surfaces).**
Every `.subscribe()` call site discards its status callback, so `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` degrade silently to "no live updates" — the exact failure class that hid the F028 publication gap. Log the status and issue a refetch on re-`SUBSCRIBED`. Add logging to the silent `return`s in `use-my-tasks-realtime.ts` (`:165,173,192,194,199,201`) so "all events discarded" is distinguishable from "no events". Add a trailing-edge debounce (~250ms) around `personal-todo-list.tsx:53-56`. Fix the `visibleProjectIds` stale closure at `use-calendar-realtime.ts:35-47`. Finally, delete `lib/tasks/reconcile-my-tasks-realtime-task.ts` and its 10 tests — four rounds with no production caller and keyed off the deprecated `assignee_id`.

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

All 13 are pre-existing. No new lint errors from M2.

### Unit tests (working tree, HEAD = 459a12c)

```
$ npx vitest run tests/unit

 Test Files  193 passed (193)
      Tests  1489 passed (1489)
   Duration  34.17s
```

### Mutation battery (detached worktree at 459a12c)

```
baseline                                          193 files / 1489 tests passed
M1 initialTaskIds -> []                           2 failed | 1484 passed   KILLED (meaningless kill)
M2 AS-016 test id "todo-1" -> "task-99"           2 failed | 5 passed      PRODUCTION BUG EXPOSED
M3 f034 fixture statusCategory null -> in_progress 1 failed | 4 passed     PRODUCTION BUG EXPOSED
M4 isTombstone -> return false                    1486 passed              SURVIVED
M5 publication migration file deleted             all green                SURVIVED
```
