# M2 — Realtime expansion — Scrutiny report #2

HEAD reviewed: `c2b7758`. Fix commits since scrutiny #1: `ec54c06` (F027),
`7310b9a` (F025), `c2b7758` (F026).

Verdict: **FAIL — milestone still rejected.**
Score: **0 PASS / 10 FAIL / 0 INCONCLUSIVE — 5 blockers, 5 major.**

Progress is real but narrow. The three wiring holes and the F012 test
regression from scrutiny #1 are genuinely fixed and mutation-confirmed. What
the fixes did **not** address is that two of the three surfaces are wired to
event streams the database will never emit, and the third only works on
desktop.

---

## Assertion results

| ID | Result | Reason |
|----|--------|--------|
| AS-015 | FAIL | `public.task_assignees` is **not a member of the `supabase_realtime` publication**. No migration adds it. Postgres emits no logical-replication rows for that table, so `onAssigned` never fires in production. F025 moved the subscription off a wrong column onto a dead stream. |
| AS-016 | FAIL | Mechanism is plausible (`tasks` is published; UPDATE → `router.refresh()`), but nothing defends the assertion. The wiring test mocks `useMyTasksRealtime` and hand-wires `refresh → setTodos`, then asserts a **personal to-do** row changed. It never observes a task row. The suite tests its own harness. |
| AS-017 | FAIL | Same publication gap as AS-015. `onUnassigned` is unreachable. The tests at `f008-my-tasks-realtime.test.ts` that "prove" un-assignment inject a `task_assignees` DELETE payload the DB will never send. |
| AS-018 | FAIL | Supabase does not RLS-filter DELETE old-records; `use-my-tasks-realtime.ts` forwards **any** deleted task id to `onDelete` with no visibility check, so ids from invisible projects reach the client. `onUpdate` likewise forwards every visible task UPDATE workspace-wide, not just tasks on the page. The only AS-018 test asserts two topic strings differ. |
| AS-019 | FAIL | Desktop is now correctly wired and mutation-tested (F027). **Mobile is not**: `AgendaList` (the `md:hidden` branch, `month-grid.tsx:126-132`) is a Server Component fed the raw server prop and receives no live updates. Below 768px the assertion is false. |
| AS-020 | FAIL | Mobile gap as above, **plus** realtime-inserted chips are fabricated: `isDone: false`, `statusCategory: null`, `projectName: ""` hardcoded in `lib/calendar/reconcile-realtime-task.ts:113-126`, and never re-derived on UPDATE. A task created (or moved) into a done status renders as not-done indefinitely. Active URL filters (`?status=/?priority=/?assigneeId=/?projectId=`) are also not applied on insert, so excluded tasks appear live. |
| AS-021 | FAIL | Desktop works and is mutation-tested. Mobile agenda never clears the entry. |
| AS-022 | FAIL | The calendar subscription still has **no server-side `filter`** — every authenticated client receives every RLS-passing `tasks` event in the DB. The documented DELETE backstop is inert: `tasks` never gets `replica identity full`, so DELETE `old` is `{id}` only, `projectId` is `undefined`, and `if (projectId && !visible…)` short-circuits and lets every DELETE through. Both tests that "cover" this fabricate `old: { id, project_id }`. |
| AS-023 | FAIL (major) | Wiring is now genuinely proven (`palette-search-realtime.test.ts:266-334` renders the real `<CommandPalette>`), and title patching is mutation-killed. But the scrutiny-#1 clobber race is untouched: `handleQueryChange` (`command-palette.tsx:203-218`) `setResults(results)` wholesale-replaces state, so a search response resolving after a realtime flush restores the pre-change title permanently. The assertion fails inside a ~100-250ms window with no further event to correct it. Zero coverage. |
| AS-024 | FAIL (major) | The soft-delete fix is correct and mutation-killed. Two residual holes: (a) for **client-role** users the soft-deleted row passes neither `tasks_select_active_members` (`deleted_at is null`) nor `tasks_select_trash_visible_members` (`not is_project_client`), so the UPDATE is dropped by RLS and the task stays in their palette forever; (b) delivery is never exercised — deleting `.subscribe()` from `subscribe-palette-search-realtime.ts:52` leaves the suite green (mutation M10, survived). |

### Severity

- **Blockers** (assertion not met at all): AS-015, AS-017, AS-018, AS-020, AS-022.
- **Major** (met on the happy path, broken on a supported path or undefended): AS-016, AS-019, AS-021, AS-023, AS-024.
- **Minor**: see "Additional defects".

### What scrutiny #1 raised and this pass confirms fixed

- F012 test regression: **fixed**, suite is 1474/1474 green.
- "Delete `useMyTasksRealtime` → suite stays green": **fixed** (M1 killed).
- "Delete `useCalendarRealtime` → suite stays green": **fixed** (M2 killed).
- Palette soft-delete never removes the task: **fixed** (M8 killed).
- Palette wiring untested: **fixed** (M3 killed, real component render).

---

## The single most important finding

`grep -rn "task_assignees" supabase/migrations/*.sql | grep -i "publication\|replica"` returns **nothing**.

`components/my-tasks/use-my-tasks-realtime.ts:120-130` subscribes to
`table: "task_assignees"`, and lines 26-42 carry a 30-line comment
explaining that this is the F025 root-cause fix. The table was created in
`20260822020000_task_assignees_table.sql` with no publication statement and
no later migration adds one. Compare the tables that got it right:
`20260818040000_realtime_tasks_publication.sql`,
`20260824050000_realtime_project_statuses_publication.sql`,
`20260904020000_chat_system.sql:335-358`.

F025 replaced a subscription that fired on the wrong column with one that
does not fire at all. AS-015 and AS-017 will *appear* to work in a manual
smoke test only because assignment writes also touch the deprecated mirror
`tasks.assignee_id` (`20260905050000_set_task_assignees_atomic.sql:47-49`,
`lib/actions/tasks.ts:362`), producing a `tasks` UPDATE that reaches
`onUpdate` → `router.refresh()`. That column is explicitly documented as
scheduled for removal by F270. When it goes, AS-015 and AS-017 go to zero
with every test still green. The recurrence path already has no mirror
write (`lib/recurrence/generate-next-occurrence.ts:214-226`), so a
recurring-occurrence assignment does not surface today.

Note the composite PK `(task_id, user_id)` means `task_assignees` DELETE
old-records already carry both columns under default replica identity —
`replica identity full` is not needed, only publication membership.

---

## Mutation testing

Run in a detached worktree at `c2b7758`. Baseline there: 192/192 files,
1474/1474 tests green.

| Mutation | Result |
|---|---|
| M1 delete `useMyTasksRealtime({…})` from `personal-todo-list.tsx` | KILLED |
| M2 delete `useCalendarRealtime({…})` from `calendar-day-grid.tsx` | KILLED |
| M3 delete `usePaletteSearchRealtime(…)` from `command-palette.tsx` | KILLED |
| M4 AS-017 `onUnassigned` becomes a no-op | KILLED (but defends a dead stream) |
| M5 AS-015 `onAssigned` becomes a no-op | KILLED (dead stream) |
| M6 AS-016 `tasks` UPDATE dispatch becomes a no-op | KILLED |
| M7 AS-018 drop the `row.user_id !== userId` guard | KILLED (dead stream) |
| M8 AS-024 drop the `deleted_at` removal branch | KILLED |
| M9 AS-023 stop applying the new title | KILLED |
| **M10 delete `.subscribe()` from `subscribe-palette-search-realtime.ts`** | **SURVIVED** |
| **M11 → M12 `flush()` applies only `events[0]`, discarding the rest of a burst** | **SURVIVED** |
| M11 delete the palette hook's `unsubscribe()` on cleanup | KILLED |

(`tests/unit/fts-tasks.test.ts` fails inside the scratch worktree regardless
of mutation — a missing-local-env artifact, unrelated; it is excluded from
the KILLED/SURVIVED judgement above.)

M10 is the important survivor: the palette can be left permanently
un-joined to its channel and no test notices, because every test captures
the callback through `.on()` and invokes it by hand. Nothing in the M2 suite
proves an event is ever *delivered* — only that it is *handled*.

---

## Tests that pass but do not defend their assertion

1. `f008-my-tasks-realtime.test.ts:85-98` asserts the `.on()` argument objects verbatim — implementation mirroring. It would pass identically whether or not the table is published.
2. `f008-…` AS-015/AS-017 cases inject `task_assignees` payloads Postgres will never emit.
3. `f008-…` AS-018 case asserts only that two topic strings differ; it would pass with RLS disabled.
4. `personal-todo-list-realtime-wiring.test.tsx:43-46` mocks `useMyTasksRealtime` and its harness hand-wires `refresh → setTodos` (lines 65-71); assertions are on personal to-do rows (89, 98, 107, 116). The My Tasks task list is never rendered.
5. `f009-calendar-realtime-subscription.test.ts:326-349` and `f027-calendar-realtime-wiring.test.tsx:216` both fabricate `old: { id, project_id }`. Production sends `old: { id }`. Correcting the fixture exposes the DELETE gate as a no-op.
6. `f009-…:53` asserts the `filter`-less subscription object as correct, cementing the AS-022 scoping gap.
7. `f235-calendar-responsive-render.test.tsx:69-70, 88-89` asserts Tailwind class strings only; it cannot see that the mobile branch is realtime-dead.
8. `lib/tasks/reconcile-my-tasks-realtime-task.ts` still has **zero production callers** (only its own test imports it) and still keys off the deprecated `assignee_id` (lines 48, 57) — it would be wrong if wired up.

---

## Additional defects (not directly assertion-blocking)

- **All four `.subscribe()` call sites discard the status callback.** `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` are swallowed with no log, toast, retry, or post-reconnect refetch. Events missed during a socket drop are lost permanently and every surface silently reverts to "needs a refresh". Given the publication gap above, a server-side binding error for `task_assignees` is exactly the class of failure this hides.
- **Refresh storm.** `onUpdate` fires an undebounced `router.refresh()` of a 5+ query RSC tree for *every* visible task UPDATE workspace-wide, not just tasks on the page. A bulk edit issues one full refetch per row.
- **Stale closures.** Both `use-calendar-realtime.ts:35-47` and `use-my-tasks-realtime.ts:199-212` disable `exhaustive-deps` with `[workspaceId]` / `[userId]` deps. The calendar is rescued only by `key={dataKey}` at `month-grid.tsx:135`; removing that plausible-looking remount silently freezes `visibleProjectIds` at first render.
- **Calendar empty-state desync.** `calendar/page.tsx:272-302` renders "No tasks are due this month" as a server-decided sibling of the live grid; a realtime INSERT leaves both on screen. `agenda-list.tsx:53-62` can never leave its empty state at all.
- **False doc comment.** `use-palette-search-realtime.ts:20-23` claims the debounce coalesces "using the LATEST payload per task id"; `flush()` reduces over all buffered events with no per-id dedup.
- **Bare `catch { return }`** at `use-palette-search-realtime.ts:61-66`. It fixed the F012 regression by suppressing the symptom rather than mocking the client in the three palette test files. Any real client-construction failure now degrades to "no live updates" with zero signal.
- **Dead read** at `reconcile-palette-search-results.ts:20` (`status` destructured, never used).

---

## Recommended follow-up features

**FU-A — Publish `task_assignees` to Supabase Realtime (blocker, AS-015/AS-017).**
Add a guarded migration in the style of `20260824050000_realtime_project_statuses_publication.sql` that adds `public.task_assignees` to the `supabase_realtime` publication after a `pg_publication_tables` existence check. The composite primary key `(task_id, user_id)` already puts both columns in the DELETE old-record, so `replica identity full` is not required. Add a migration-level assertion test that fails if publication membership is ever lost, so the client hook's central dependency is guarded by a test rather than by a code comment. Until this lands, F025's entire rewrite is inert and every `task_assignees` test in `f008-my-tasks-realtime.test.ts` is verifying a stream that does not exist.

**FU-B — Give the mobile calendar live state (blocker, AS-019/AS-020/AS-021).**
`AgendaList` sits below the `md:hidden` split in `month-grid.tsx:126-132` and is a Server Component fed the raw `tasksByDateObject` prop, so all three calendar assertions are simply false on a phone. Lift the `byDate` `useState` currently owned by `CalendarDayGrid` up into a client component that wraps *both* responsive branches, and pass the same live map to the agenda list and the day grid. Cover it with a component test that renders the mobile branch, dispatches a due-date-change event, and asserts the agenda entry moved — the responsive suite currently asserts Tailwind class strings only and cannot see this.

**FU-C — Make the AS-022 visibility gate real (blocker).**
Add `alter table public.tasks replica identity full;` so DELETE payloads actually carry `project_id`, then tighten `lib/calendar/reconcile-realtime-task.ts:77` to *reject* a DELETE whose `project_id` is absent or not visible, rather than falling through on a falsy value. Add a server-side `filter` to both the calendar and palette subscriptions so foreign task ids stop crossing the wire at all. Every test fixture that currently hand-writes `old: { id, project_id }` must be changed to the real default-replica-identity shape `old: { id }` first, so the fix is demonstrably driven by a failing test.

**FU-D — Correct realtime-inserted calendar chip data and honour active filters (blocker, AS-020).**
`reconcile-realtime-task.ts:113-126` hardcodes `isDone: false`, `statusCategory: null`, `projectKey: null`, `projectName: ""` on insert and never re-derives them on update, so a task created or moved into a done-category status renders permanently as not-done with a blank project label. Resolve these from the workspace's status set (already available server-side and passed into the grid) or refetch the joined row on insert. Separately, thread the resolved `CalendarTaskFilters` from `calendar/page.tsx` through `CalendarDayGrid` into the reconciler and drop events that do not match the active `status`/`priority`/`assigneeId`/`projectId` filters, so a filtered calendar stops gaining tasks the server query deliberately excluded.

**FU-E — Prove delivery, not just handling (blocker, all ten assertions).**
Mutation M10 shows `.subscribe()` can be deleted from the palette channel with the suite still green, because every M2 test captures its callback through `.on()` and invokes it by hand. Extend the shared channel-mock helper to record `.subscribe()` and assert it was called for every realtime surface, and add at least one integration test per surface that runs against a live or emulated Supabase instance and confirms an actual write produces a client-side event. This is the only class of test that would have caught the `task_assignees` publication gap, and it is the difference between "the reconciler is correct" and "the assertion holds".

**FU-F — Scope and debounce My Tasks realtime (major, AS-016/AS-018).**
`onDelete` currently forwards any deleted task id with no visibility check (Supabase does not RLS-filter DELETE old-records), and `onUpdate` forwards every visible task UPDATE workspace-wide, firing an undebounced `router.refresh()` of a 5+ query RSC tree per event. Narrow both to the id set the page is actually displaying, debounce the refresh, and either wire up `lib/tasks/reconcile-my-tasks-realtime-task.ts` (after correcting it off the deprecated `assignee_id`) or delete it — it has no production callers today. The accompanying test must render the My Tasks task rows and assert a status change is reflected there, not assert that a hand-wired harness updated a personal to-do.

**FU-G — Guard the palette against search/realtime clobbering (major, AS-023).**
`handleQueryChange` at `command-palette.tsx:203-218` replaces `results` wholesale when a search resolves, discarding any realtime patch applied in the interim; the existing guard only orders searches against each other. Introduce a generation counter incremented on every realtime flush and compared before applying a search response, or re-apply buffered events after a search settles. Test by resolving a mocked `searchPalette` *after* firing the realtime event and asserting the new title survives.

**FU-H — Cover client-role soft-delete visibility (major, AS-024).**
For a client-role user a soft-deleted task satisfies neither `tasks_select_active_members` (`deleted_at is null`) nor `tasks_select_trash_visible_members` (`not is_project_client`), so the `deleted_at` UPDATE is dropped by RLS and the task remains in their palette results indefinitely. Either broadcast deletions on a channel the client role can see, or have the palette drop results that a follow-up visibility check no longer returns. Add an RLS-level test asserting which roles can observe a soft-delete event.

**FU-I — Surface and recover from subscription failure (minor, all surfaces).**
Every `.subscribe()` call site discards its status callback. Handle `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` with at minimum a logged warning, and issue a `router.refresh()` / refetch on re-`SUBSCRIBED` so events missed during a socket drop are recovered instead of silently lost. Also fix the false coalescing claim in `use-palette-search-realtime.ts:20-23` (implement per-id dedup in `flush()` or delete the claim) and remove the dead `status` destructure at `reconcile-palette-search-results.ts:20`.

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

All 13 are pre-existing `@typescript-eslint/no-unused-vars` warnings in test
files plus one unused eslint-disable directive. No new lint errors from M2.

### Unit tests (working tree, HEAD = c2b7758)

```
$ npx vitest run tests/unit

 Test Files  192 passed (192)
      Tests  1474 passed (1474)
   Duration  34.21s
```

The 8 F012-regression failures reported in scrutiny #1 are resolved.

### Mutation battery (detached worktree at c2b7758)

```
baseline                                                Test Files 192 passed (192) / Tests 1474 passed

M1  delete useMyTasksRealtime call                      KILLED   personal-todo-list-realtime-wiring.test.tsx
M2  delete useCalendarRealtime call                     KILLED   f027-calendar-realtime-wiring.test.tsx
M3  delete usePaletteSearchRealtime call                KILLED   palette-search-realtime.test.ts
M4  AS-017 onUnassigned no-op                           KILLED   f008-my-tasks-realtime.test.ts
M5  AS-015 onAssigned no-op                             KILLED   f008-my-tasks-realtime.test.ts
M6  AS-016 tasks UPDATE dispatch no-op                  KILLED   f008-my-tasks-realtime.test.ts
M7  AS-018 drop user_id scoping guard                   KILLED   f008-my-tasks-realtime.test.ts
M8  AS-024 drop deleted_at removal branch               KILLED   palette-search-realtime.test.ts
M9  AS-023 title patch no-op                            KILLED   palette-search-realtime.test.ts
M10 delete .subscribe() in palette channel              SURVIVED (only fts-tasks.test.ts env artifact failed)
M11 delete unsubscribe() on hook cleanup                KILLED   palette-search-realtime.test.ts
M12 flush() applies only events[0]                      SURVIVED (only fts-tasks.test.ts env artifact failed)
```

`tests/unit/fts-tasks.test.ts` fails only inside the scratch worktree
(missing local env) and passes in the working tree; it is unrelated to any
mutation and is discounted in the verdicts above.

### Publication membership check

```
$ grep -rn "task_assignees" supabase/migrations/*.sql | grep -i "publication\|replica"
(no output)

$ grep -rn "replica identity" supabase/migrations/*.sql
20260823080000_fix_comment_reactions_soft_delete_and_scoping.sql:77: alter table comment_reactions replica identity full;
20260904080000_message_reactions_channel_id.sql:40:                    alter table message_reactions replica identity full;
20260824050000_realtime_project_statuses_publication.sql:22:           alter table project_statuses replica identity full;
```

`public.tasks` is published (`20260818040000`) but has default replica
identity. `public.task_assignees` is neither published nor mentioned.
