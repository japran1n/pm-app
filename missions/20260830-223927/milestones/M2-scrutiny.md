# M2 — Realtime expansion — Scrutiny report

Verdict: **FAIL — milestone rejected.**
Features reviewed: F008, F009, F010, F011, F012. Assertions AS-015 … AS-024.

Method: three independent parallel code reviews (My Tasks / Calendar / Palette),
full unit suite, lint, typecheck, plus a mutation battery run in a detached
git worktree (working tree never modified).

---

## Assertion results

| ID | Result | Reason |
|----|--------|--------|
| AS-015 | FAIL | Subscription filters on the **deprecated** `tasks.assignee_id` mirror column; My Tasks renders assignment from the `task_assignees` join table, which is not in the realtime publication. Second-and-later assignees never receive an event. |
| AS-016 | FAIL | Same wrong-column dependency. Additionally, watched-but-unassigned rows (`?watched=1`) can never match the filter, so their status changes are silently invisible. |
| AS-017 | FAIL | Supabase evaluates a `postgres_changes` UPDATE row filter against the **new** record. On un-assign, `assignee_id` no longer equals the user, so the event is dropped server-side. The `row.assignee_id !== userId -> onDelete` branch is unreachable in production. |
| AS-018 | INCONCLUSIVE | No RLS bypass and no admin client on the read path, so nothing forbidden is delivered. But `tasks` never gets `replica identity full`, so DELETE payloads carry only the PK, the filter cannot match, and all DELETE events are dropped. The path is inert rather than verified. |
| AS-019 | FAIL | Reconciler logic is correct and bucket keys are timezone-consistent, but nothing tests that an event reaches React state; deleting the entire `useCalendarRealtime` call leaves the suite green. Mobile (`AgendaList`, `md:hidden`) is a Server Component and never updates. |
| AS-020 | FAIL | Same zero wiring coverage. Realtime-inserted tasks are also rendered with fabricated data: `isDone: false` and `statusCategory: null` hardcoded, so a task created in a Done column renders as not-done. |
| AS-021 | FAIL | Same zero wiring coverage. Also holed for client-role users: the trash RLS policy excludes clients, so a trashed task's UPDATE broadcast is filtered out and the chip stays on their calendar indefinitely. |
| AS-022 | FAIL | The subscription has **no filter at all**. The documented DELETE backstop is dead code: `tasks` lacks `replica identity full`, so `old.project_id` is always `undefined` and the guard `if (projectId && !visible...)` short-circuits on the falsy value, letting every DELETE through. |
| AS-023 | FAIL (fragile) | Wiring is genuinely correct and the patch renders. But a search response that resolves after a realtime flush wholesale replaces state with a pre-write server snapshot, permanently discarding the patch (buffer already drained). ~200-600ms window after the last keystroke. |
| AS-024 | FAIL | **Deleted tasks are never removed.** `deleteTask` calls `cascade_delete_task`, which is `update tasks set deleted_at = now()` — a soft delete, never a DB `DELETE`. The reconciler's UPDATE branch ignores `deleted_at` and merely patches the title, leaving the deleted task in results. The DELETE branch is unreachable. |

### Severity

**Blockers** (assertion not met): AS-015, AS-016, AS-017, AS-019, AS-020, AS-021, AS-022, AS-024, plus the F012 test regression below.
**Major** (met but fragile): AS-023.
**Open** : AS-018.

---

## Regression introduced by F012 (blocker, independent of any assertion)

Commit `5995c49` broke **8 previously-green tests** across 3 files.
`usePaletteSearchRealtime` calls `createClient()` unconditionally inside its
effect (`lib/hooks/use-palette-search-realtime.ts:55`), and the palette
component tests mock neither the hook nor `@/lib/supabase/client`:

```
Error: @supabase/ssr: Your project's URL and API key are required to create a Supabase client!
 ❯ lib/hooks/use-palette-search-realtime.ts:55:22
```

Failing: `palette-search-results.tsx` (5: AS-460 grouping, both AS-461
navigation tests, AS-466, and the AS-460 stale-response guard),
`palette-actions-recents.tsx` (2: AS-462, AS-465),
`command-palette-shell.tsx` (1: AS-463).

Causality confirmed by checkout at the parent commit `8a96d2a`, where the same
three files pass **25/25**. The F012 handoff's claim of `npm test` (0) is
false, as is F008's claim that the only failures were pre-existing DB
schema-cache issues.

---

## Mutation testing

Run in a detached worktree at HEAD (`841789f`). "Survived" = the suite stayed
green with the behaviour deliberately broken.

| Mutation | Result |
|---|---|
| Calendar: clearing `due_date` becomes a no-op (kills AS-021) | KILLED |
| Calendar: skip removing stale placement — chip on both days (kills AS-019) | KILLED |
| Calendar: drop `visibleProjectIds` gate on INSERT/UPDATE (kills AS-022) | KILLED |
| Calendar: drop `visibleProjectIds` gate on DELETE (kills AS-022) | KILLED |
| **Delete the whole `useCalendarRealtime({...})` call from `calendar-day-grid.tsx`** | **SURVIVED — full unit suite green** |
| **Delete the whole `useMyTasksRealtime({...})` call from `personal-todo-list.tsx`** | **SURVIVED — full unit suite green** |

The pure reconcilers are well tested. The **wiring is not tested at all**:
realtime can be entirely unplugged from both the calendar and My Tasks and no
test notices. Every M2 assertion is phrased as "without a page refresh" — i.e.
they are all assertions about wiring.

---

## Tests that pass but do not defend their assertion

1. `f008-my-tasks-realtime.test.ts:54` asserts `filter: "assignee_id=eq.user-1"` verbatim — it **enforces the bug**; correcting the column to `task_assignees` would fail this test. Pure implementation mirroring.
2. `f008-my-tasks-realtime.test.ts:120-166` (AS-017) hand-injects a payload the production filter would never deliver.
3. `f008-my-tasks-realtime.test.ts:191` (AS-018) asserts only that two topic strings differ — it would pass with RLS entirely disabled.
4. All 10 tests in `reconcile-my-tasks-realtime-task.test.ts` exercise a function with **zero production callers** (grep confirms only its definition and its own test).
5. `f009-calendar-realtime-subscription.test.ts:326` (AS-022 DELETE gate) passes only because the test fabricates `old: { id, project_id }`. Production sends `old: { id }`. Changing the fixture to the real shape reveals the gate as a no-op.
6. `f009-...:53` asserts the `filter`-less subscription object as correct, cementing the missing scoping instead of probing AS-022.
7. `palette-search-realtime.test.ts:105` is the **only** AS-024 coverage and it tests a branch production never reaches.
8. No test anywhere exists for `usePaletteSearchRealtime` itself — debounce, coalescing, unmount cleanup, and the clobber race are all uncovered.

---

## Additional defects (not assertion-blocking)

- **Calendar filters bypassed.** With `?status=`/`?priority=`/`?assigneeId=`/`?projectId=` active, the reconciler receives no filter parameter and inserts tasks the server query would have excluded. They appear live and vanish only on refresh.
- **Calendar empty-state desync.** The "No tasks are due this month" branch is decided server-side, so it persists beneath a grid that has since gained live chips.
- **Stale visibility set.** `visibleProjectIds` is snapshotted at render; a project created after page load has all its events dropped until navigation.
- **Silent failure everywhere.** All three `.subscribe()` calls discard the status callback. `CHANNEL_ERROR` / `TIMED_OUT` / token expiry degrades the surface to permanently stale with no toast, log, or indicator.
- **Refresh amplification.** Every matching My Tasks event triggers an undebounced full server re-render of a page running 5+ queries; a bulk reassignment issues one refetch per row.
- **My Tasks not workspace-scoped** — an assignment in workspace B refreshes workspace A's page.
- **Dead read** at `reconcile-palette-search-results.ts:20` (`status` destructured, never used; `PaletteTaskResult` has no such field).
- **F010 delivered zero code**, accepting F009's artifact. That is defensible, but it means AS-019…AS-022 received one implementation and one review pass, not two.

---

## Recommended follow-up features

**FU-1 — Correct the My Tasks realtime source of truth (blocker, AS-015/016/017).**
The subscription must stop depending on the deprecated `tasks.assignee_id` mirror. Add `public.task_assignees` to the `supabase_realtime` publication with `replica identity full`, and subscribe filtered on `user_id=eq.<userId>`; that table's INSERT and DELETE map directly onto assignment and un-assignment without relying on the mirror write or on UPDATE-filter semantics. Retain a `tasks` subscription for status changes (AS-016) but drive its membership test from the client's known task-id set rather than `assignee_id`, so it also covers watched-but-unassigned rows. Update `reconcileMyTasksRealtimeTask` to match, and either wire it to a real caller or delete it.

**FU-2 — Fix palette soft-delete removal (blocker, AS-024).**
`reconcilePaletteSearchResults` must treat an UPDATE carrying a non-null `deleted_at` as a removal, mirroring `lib/board/reconcile-realtime-task.ts:85-88`. Keep the DELETE branch for the owner-only purge path. The accompanying test must use a realistic payload — `updateEvent({ id, deleted_at })` — the way the board and calendar suites already do, rather than a synthetic `eventType: "DELETE"` that production never emits.

**FU-3 — Repair the F012 test regression (blocker).**
Restore the 8 broken tests in `palette-search-results.test.tsx`, `palette-actions-recents.test.tsx`, and `command-palette-shell.test.tsx` by mocking `@/lib/supabase/client` (or the hook) in those suites. The hook should additionally tolerate a missing Supabase configuration without throwing out of a React effect, so that a client-construction failure degrades to "no realtime" instead of unmounting the palette.

**FU-4 — Add wiring tests for calendar and My Tasks realtime (blocker, AS-015/016/019/020/021).**
Both surfaces currently pass every test with realtime entirely deleted. Add component-level tests that mock the `subscribeTo*Realtime` module, dispatch a fake payload through the captured callback, and assert on **rendered output** — that the chip moved to the new day cell, disappeared when the due date cleared, and that the My Tasks list reflects the change. These are the tests whose absence lets all three assertions break silently.

**FU-5 — Make the AS-022 DELETE backstop real.**
Add `alter table public.tasks replica identity full;` so DELETE payloads actually carry `project_id`, then tighten the guard to reject a DELETE whose `project_id` is absent *or* not visible. Alternatively, drop the false claim from the doc comments in `reconcile-realtime-task.ts` and `subscribe-calendar-realtime.ts` and gate DELETE solely on "id already in local state". Also add a server-side `filter` to the calendar and palette subscriptions so foreign task ids stop reaching the client callback.

**FU-6 — Apply active calendar filters during reconciliation (major).**
Thread the resolved filter set from `MonthGrid` into `CalendarDayGrid` and `reconcileCalendarRealtimeEvent`, and apply it before inserting. Also patch `projectId` on the UPDATE merge path (currently never updated, leaving stale deep links after a cross-project move) and resolve `isDone`/`statusCategory` rather than hardcoding `false`/`null`.

**FU-7 — Live-update the mobile calendar (major).**
`AgendaList` is a Server Component below the `md:hidden` split and never receives realtime updates, so AS-019/020/021 fail outright on mobile viewports. Lift the `byDate` state above the responsive split in `month-grid.tsx` so both the day grid and the agenda list read the same live state.

**FU-8 — Guard the palette against realtime/search clobbering (major, AS-023).**
Introduce a results-generation stamp incremented on each realtime flush and compared when a search response resolves, or re-apply buffered events after a search settles, so a late server snapshot cannot silently discard a realtime patch.

**FU-9 — Surface realtime subscription failures (minor).**
All the `.subscribe()` call sites discard their status callback. Handle `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` with at minimum a logged warning and ideally a stale-data indicator plus reconnect, so a dropped socket does not present as a silently frozen page.

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
✖ 13 problems (0 errors, 13 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

All 13 are pre-existing `no-unused-vars` warnings in test files plus one unused
eslint-disable directive in `components/chat/message-list.tsx:161`. No new
lint errors from M2.

### Unit tests (working tree, HEAD = 841789f)

```
$ npx vitest run tests/unit

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 8 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/unit/command-palette-shell.test.tsx > CommandPalette shell > test_AS_463_input_is_focusable_and_accepts_keyboard_typing
 FAIL  tests/unit/palette-actions-recents.test.tsx > CommandPalette actions (F243, AS-462) > test_AS_462_typing_a_query_hides_the_actions_group
 FAIL  tests/unit/palette-actions-recents.test.tsx > CommandPalette recents (F243, AS-465) > test_AS_465_typing_a_query_hides_the_recents_group
 FAIL  tests/unit/palette-search-results.test.tsx > CommandPalette search results (F242) > test_AS_460_groups_results_by_type
 FAIL  tests/unit/palette-search-results.test.tsx > CommandPalette search results (F242) > test_AS_461_selecting_a_project_result_navigates_to_it
 FAIL  tests/unit/palette-search-results.test.tsx > CommandPalette search results (F242) > test_AS_461_selecting_a_task_result_navigates_to_it
 FAIL  tests/unit/palette-search-results.test.tsx > CommandPalette search results (F242) > test_AS_466_empty_result_set_shows_explicit_no_results_state
 FAIL  tests/unit/palette-search-results.test.tsx > CommandPalette search results (F242) > test_AS_460_stale_slower_response_does_not_clobber_a_newer_faster_one

Error: @supabase/ssr: Your project's URL and API key are required to create a Supabase client!
 ❯ createBrowserClient node_modules/@supabase/ssr/src/createBrowserClient.ts:105:10
 ❯ createClient lib/supabase/client.ts:7:10
 ❯ lib/hooks/use-palette-search-realtime.ts:55:22

 Test Files  3 failed | 187 passed (190)
      Tests  8 failed | 1451 passed (1459)
   Duration  43.38s
```

### Same three files at the pre-F012 commit

```
$ git worktree add <scratch> 8a96d2a
$ npx vitest run tests/unit/palette-search-results.test.tsx \
      tests/unit/palette-actions-recents.test.tsx \
      tests/unit/command-palette-shell.test.tsx

 Test Files  3 passed (3)
      Tests  25 passed (25)
   Duration  2.43s
```

### Surviving mutations

```
# Mutation: remove useMyTasksRealtime({...}) from components/my-tasks/personal-todo-list.tsx
$ npx vitest run tests/unit
 Test Files  4 failed | 186 passed (190)
 FAIL  tests/unit/command-palette-shell.test.tsx      <- pre-existing (F012 regression)
 FAIL  tests/unit/palette-actions-recents.test.tsx    <- pre-existing (F012 regression)
 FAIL  tests/unit/palette-search-results.test.tsx     <- pre-existing (F012 regression)
 FAIL  tests/unit/fts-tasks.test.ts                   <- worktree env artifact, not mutation-related
 => No My Tasks test detected the removal. MUTATION SURVIVED.

# Mutation: remove useCalendarRealtime({...}) from components/calendar/calendar-day-grid.tsx
$ npx vitest run tests/unit
 Test Files  4 failed | 186 passed (190)   (identical failure set)
 => No calendar test detected the removal. MUTATION SURVIVED.
```

Note: `tests/unit/fts-tasks.test.ts` fails only inside the scratch worktree
(missing local env) and passes in the working tree; it is unrelated to any
mutation.

### Killed mutations (calendar reconciler)

```
CAL-M1 clear-due-date becomes no-op (AS-021)        -> Test Files 1 failed  KILLED
CAL-M2 move leaves stale copy on old day (AS-019)   -> Test Files 1 failed  KILLED
CAL-M3 no project-visibility gate on INSERT/UPDATE  -> Test Files 1 failed  KILLED
CAL-M4 DELETE ignores project visibility (AS-022)   -> Test Files 1 failed  KILLED
```
