# M16 — Views: scrutiny report

Scope: F218–F240 + F324. Assertions AS-403–AS-458.
Method: 7 parallel per-feature reviewers reading code/SQL only (no handoffs passed in),
plus independent verification by this validator of every claimed blocker. Two reviewer
claims were empirically **refuted** and are recorded as such.

Toolchain: `tsc --noEmit` clean; `eslint .` 0 errors / 2 known warnings; unit suite
988/990 (2 failures = known pre-existing `trash-list.test.tsx`). All M16 integration
files pass when run individually; batch failures were the known Supabase auth rate limit
(re-ran f221/f222/f224/f229 alone — all green).

**Verdict: NOT GREEN. 6 blockers.**

## Assertion table

| ID | Verdict | Reason |
|---|---|---|
| AS-403 | PASS | `project_statuses` is per-project with FK + RLS; board/list/search all read it. |
| AS-404 | **FAIL** | Renaming any *seeded default* column always fails validation — B3. |
| AS-405 | PASS | colour + `category` CHECK (`not_started`/`in_progress`/`done`) in DB and Zod. |
| AS-406 | PASS | `reassign_and_delete_project_status` moves tasks + deletes in one transaction; same-project and source≠destination re-validated inside it. |
| AS-407 | PASS | `projects_seed_default_statuses` AFTER INSERT trigger covers every insert path. |
| AS-408 | PASS | Backfill matches on `(project_id, name)` before the sync trigger exists; `tasks.status` untouched. |
| AS-409 | PASS | `moveAndReorderTask` re-verifies the name against `project_statuses` and writes status+position atomically. |
| AS-410 | PASS | `is_done_status()` / `lib/tasks/status-category.ts` used at every reachable site; all surviving literal `'done'` SQL is in superseded migrations. Caveat M4. |
| AS-411 | **FAIL** | List filter matches stale `tasks.status` text; after a rename the column returns zero rows — B2. |
| AS-412 | PASS | `get_status_counts` groups on `coalesce(ps.name, t.status)` with real colour/category, `security invoker`. |
| AS-413 | PASS | Realtime channel + reducer correct. Caveat M5 (DELETE payloads unfiltered). |
| AS-414 | **FAIL** | `project_statuses` write policies gate on visibility only, no role — any viewer can mutate columns directly — B4. |
| AS-415 | PASS | `prevent_last_project_status_delete` trigger holds. Caveat M6 (concurrent-delete TOCTOU). |
| AS-416 | PASS | `getProjectColumns` orders by `position` server-side; board re-sorts. |
| AS-417 | PASS | Search resolves the name via `status_id`; explicitly tested against stale status text. |
| AS-418 | PASS | `groupTasksIntoSwimlanes` handles assignee/priority/tag. |
| AS-419 | **FAIL** | "No grouping" deletes the URL param, which the board resolves back to the persisted grouping — B6. |
| AS-420 | PASS | Cross-lane drops call real `editTask`/`setTaskAssignees`/`updateTaskTags`; auth enforced server-side. |
| AS-421 | PASS | Each lane counts only its own slice; counted array is the rendered array. |
| AS-422 | PASS | Genuine server round trip via `board_swimlane_prefs`; own-row RLS; both FKs cascade. |
| AS-423 | PASS | `SWIMLANE_NONE_KEY` sentinel lane, rendered last, only when non-empty. |
| AS-424 | PASS | Per-(user, project) row, read-merge upsert so collapse/groupBy writes don't clobber each other. |
| AS-425 | PASS (untested) | Position maths correctly uses global column neighbours, not the lane slice. No test exercises the grouped drag path — M7. |
| AS-426 | PASS | Filters/sort/grouping all persist in `config`. |
| AS-427 | PASS | `scope` CHECK + distinct SELECT branches, DB-enforced. |
| AS-428 | **FAIL** | `groupBy` is stored but never read or applied by the list page — M8. |
| AS-429 | PASS | SELECT uses `is_project_visible_to`, so private-project membership is honoured. |
| AS-430 | PASS | Enforced server-side in `authorizeViewMutation` + `canManageSavedView`, not just UI. |
| AS-431 | PASS | `set_saved_view_default` is service-role only; every caller re-checks `ownerId === user.id`. |
| AS-432 | PASS | `getSavedView` is RLS-scoped and pins `projectId`; another user's personal view resolves to not-found, no leak. |
| AS-433 | **FAIL** | Dangling status/member degrade fine, but a malformed `config` is cast without parsing and throws — M9. |
| AS-434 | PASS (read) | Personal views owner-only on SELECT. Write-side caveat is B5. |
| AS-435 | PASS | RLS session client, `task_assignees!inner` filter-only embed, workspace-scoped. |
| AS-436 | PASS | Timezone-correct string bucketing, no `Date` round trip. Caveat M10 (done tasks sit in Overdue). |
| AS-437 | PASS | `projects.deleted_at` is the archive timestamp in this schema; both it and `tasks.deleted_at` filtered on both queries. |
| AS-438 | PASS | Real `moveTaskStatus`; target column resolved with `.eq("project_id", ...)`, so cross-project `status_id` corruption is unreachable. |
| AS-439 | PASS | `projectName` from the RLS-permitted `projects!inner` embed. |
| AS-440 | PASS | Real zero-row path drives headline + explainer + CTA. |
| AS-441 | PASS (wrong data) | Works, but the watcher read omits `.eq("is_watching", true)` — M1. |
| AS-442 | **FAIL** | Desktop grid renders stale tasks after any soft navigation — B1. |
| AS-443 | **FAIL** | Month nav updates the header and cells but not the tasks — B1. |
| AS-444 | PASS | Real `?taskId=` board deep link from both chip and overflow popover. |
| AS-445 | PASS | `handleDragEnd` passes the cell's own `YYYY-MM-DD` to real `editTask`; start>due CHECK is surfaced, not swallowed; rollback + single toast. |
| AS-446 | PASS (misleading) | Undated tasks excluded by construction and explained, but the count ignores active filters — M2. |
| AS-447 | PASS | Real popover; cutoff of 3 matches `slice(0,3)`/`slice(3)`; `+N` counts the hidden set. |
| AS-448 | **FAIL** | Filtering is correct server-side, but applying a filter doesn't change the desktop grid — B1. |
| AS-449 | INCONCLUSIVE | Only behavioural proof is an authenticated Playwright spec blocked by the known-broken login helper; the unit test is a className mirror — M3. |
| AS-450 | PASS | One `getCurrentUserTimezone` feeds both the default month and `isToday`; never server-local. |
| AS-451 | PASS | `computeBarLayout` emits inclusive-width range bars. |
| AS-452 | PASS | Null start collapses to a one-day marker on the due date. |
| AS-453 | PASS | Real DB CHECK `tasks_start_date_not_after_due_date`, verified by admin-client inserts that bypass Zod. Caveat M11 (`bulkUpdateTasks`). |
| AS-454 | PASS | Drag/resize routes through `editTask`, which re-checks role *and* private-project visibility server-side; `canDrag` is cosmetic. Caveat M12. |
| AS-455 | PASS | `getTimelineDependencyEdges` is RLS-scoped and both-endpoint constrained; the `20260828020000` two-sided fix mirrors the INSERT policy and doesn't break legitimate reads. |
| AS-456 | PASS | Zoom changes pixels/day, tick granularity, **and** the fetched range (`timelineRangeForZoom`); quarter fetches 13 months. |
| AS-457 | PASS | Today line resolved from the user's profile timezone; omitted, not clamped, when out of range. |
| AS-458 | PASS | Single `overflow-x-auto` container wraps scale and rows; sticky name column inside it. |

## Blockers

### B1 — Calendar desktop grid shows stale tasks after any navigation (AS-442, AS-443, AS-448)
`components/calendar/calendar-day-grid.tsx:84` — `const [byDate, setByDate] = useState(tasksByDate);`
There is no `key` on `<CalendarDayGrid>` (`components/calendar/month-grid.tsx:112-117`) and no prop-sync effect
(`grep useEffect` in that file returns nothing). Month nav is a `<Link>` and filters are `router.push` — both are
soft navigations on the same route, so the component stays mounted and the `useState` initializer never re-runs.
`days` is a plain prop and updates; `byDate` does not. Line 146 renders `tasks={byDate[day.date] ?? []}`.

Failure: on desktop, view June 2026, click "→". The header reads "July 2026" and the cells are July dates, but every
lookup `byDate["2026-07-.."]` misses the June-keyed object → **the entire month renders empty**. Identical for applying
an assignee filter: the chips never change. Mobile is unaffected because `AgendaList` is a pure-prop server component,
so the fallback surface works while the primary one does not. No test catches it because every test mounts fresh.

### B2 — Renaming a board column strands every task in it (AS-411, and the board itself)
`lib/actions/statuses.ts:311` updates `project_statuses.name` only. The sync trigger `sync_task_status_and_status_id`
is `before insert or update on tasks` — it never fires on a `project_statuses` write, so `tasks.status` text goes stale.
`components/board/board.tsx:792` groups with `tasks.filter((task) => task.status === column.name)`.

Failure: a project adds a column "QA", puts 8 tasks in it, then renames it to "Review". No task matches any column name →
**all 8 disappear from the board** for every viewer (instantly for anyone on the AS-413 realtime path). The list view's
status filter has the same defect: options come from column names, filtering matches stale `tasks.status`, so selecting
"Review" returns zero rows. Compounding: the next write to such a task runs the trigger's name lookup, finds nothing, and
sets `status_id = NULL`, dropping the task out of the board RPCs entirely.

### B3 — Renaming a default column is impossible: seed colours are not in the approved palette (AS-404)
`components/project/status-manager.tsx:163-166` — the name `onBlur` calls `submitUpdate(name, color, category)` with the
column's *current* colour. Seeded defaults use `#94a3b8`, `#3b82f6`, `#f59e0b`, `#22c55e`
(`supabase/migrations/20260824010000_project_statuses.sql:122-125`), but `COLUMN_COLOR_PALETTE`
(`lib/board/column-colors.ts:22-31`) is `#64748b, #3b82f6, #d97706, #16a34a, #ef4444, #ea580c, #a16207, #475569`.
Only `in_progress` overlaps.

Failure: rename "todo" → "Backlog". `columnColorSchema.refine(isApprovedColumnColor)` (`lib/validation/statuses.ts:20-22`)
rejects `#94a3b8`; the UI rolls the name back and toasts "Choose a colour from the approved palette." **Three of the four
columns every project ships with can never be renamed or recategorised.** Invisible to the suite because
`tests/integration/f219-status-management.test.ts:237` renames a freshly-added column that already has a palette colour.

### B4 — Any viewer can add, rename, or delete another team's board columns (AS-414, security)
`supabase/migrations/20260824010000_project_statuses.sql:68-95` — the INSERT/UPDATE/DELETE policies gate on
`public.is_project_visible_to(project_id)` alone. That function (`20260821140526_project_visibility_rls_sweep.sql:37-62`)
returns true for **any active workspace member**, including `viewer` and `guest`. Role is checked only in application code
(`authorizeColumnManagement` → `canManageColumns`).

Exploit: the browser client uses the publishable key. A viewer opens devtools and runs
`supabase.from('project_statuses').delete().eq('project_id', <id>)` — `canManageColumns` is never consulted. The three
AS-414 tests (`f219-status-management.test.ts:374,399,429`) only assert the Server Action returns `ok:false`; none attempts
the direct RLS path, so the suite is green on an open door.

### B5 — `saved_views` UPDATE policy lets a row be relocated into a workspace or project the owner cannot see (AS-434, security)
`supabase/migrations/20260826010000_create_saved_views.sql:143-145` — `using (owner_id = auth.uid())` /
`with check (owner_id = auth.uid())`. `workspace_id`, `project_id`, and `scope` are all mutable and unchecked, and the
INSERT policy's visibility clause (lines 130-135) is **not** mirrored on UPDATE. No trigger compensates.

Exploit: create a legitimate personal view on a visible project, then
`PATCH /saved_views?id=eq.<own>` setting `project_id=null`, `workspace_id=<a foreign tenant>`, `scope='shared'`. The SELECT
branch `project_id is null and is_active_workspace_member(workspace_id)` is evaluated against the *viewer*, so the row now
renders in that tenant's view switcher with an attacker-controlled name and `?viewId=` link. Cross-tenant write and a
phishing surface; the action layer is bypassed entirely. `tests/integration/rls-saved-views.test.ts:429` tests INSERT
forgery only, never a `project_id`/`workspace_id` mutation.

### B6 — "No grouping" cannot be reselected (AS-419)
`components/board/board-toolbar.tsx:52-56` deletes the param when the user picks "No grouping"
(`if (value === "none") { params.delete("groupBy"); }`). But `components/board/board.tsx:669-675` resolves an **absent**
param to `initialSwimlanePrefs.groupBy` and only an **explicit** `?groupBy=none` to none. The comment at board.tsx:663-664
asserts the toolbar writes `groupBy=none` — it does not.

Failure: a user with persisted `groupBy: "tag"` opens the board (lanes render) and selects "No grouping". The URL becomes
byte-identical to the cached one, the RSC payload still carries `"tag"`, the board stays in swimlanes and the Select snaps
back to "Tag". Even on a cache miss, the RSC refetch races the fire-and-forget `upsertBoardSwimlanePrefs` issued *after*
`router.push`. `tests/unit/f226-swimlane-collapse-persist.test.ts:95` tests `?groupBy=none` — a URL the only real producer
never generates. One-line fix: `params.set("groupBy", "none")`.

## Majors

- **M1 — Watched tasks include tasks the user explicitly unwatched (AS-441).** `lib/queries/my-tasks.ts:175-178` selects
  `task_watchers` with only `.eq("user_id", userId)`; it never filters `.eq("is_watching", true)`. Since
  `20260822053000_task_watchers_durable_unwatch.sql`, unwatch flips the flag rather than deleting the row, and
  `unwatchTask` upserts an `is_watching:false` row even for a never-watcher. Every other reader in the repo filters
  correctly (`lib/actions/tasks.ts:1524, 2732, 3226, 3753`). Result: a task you unwatched appears under "Include tasks I
  watch" with a "Watching" badge and cannot be removed by any UI action. One-line fix.
- **M2 — Undated calendar count ignores active filters (AS-446).** `calendar/page.tsx:145` calls
  `getUndatedTaskCount(workspace.id)` with no filters (the function only supports `projectId`). With an assignee+project
  filter active the footer still counts the whole workspace. Documented as deliberate at page.tsx:141-144, but the rendered
  sentence is unqualified and therefore misleading.
- **M3 — AS-449 has no runnable behavioural proof.** `tests/unit/f235-calendar-responsive-render.test.tsx:51-87` asserts
  Tailwind class strings (`toContain("hidden")`, `toContain("md:block")`) — it mirrors the implementation and would survive
  any real layout break. The genuine 375px viewport test is `tests/e2e/f235-calendar-responsive.spec.ts:192`, blocked by the
  known-broken `loginAndGoToDashboard` helper.
- **M4 — Blocked-done guard is not category-aware at 3 of 4 call sites (AS-410).**
  `components/task/blocked-done-guard.tsx:98` falls back to literal `status === "done"` when `nextStatusCategory` is
  omitted, which it is at `list-status-select.tsx:109`, `task-detail-sheet.tsx:724`, and `bulk-status-action.tsx:72`; only
  `board.tsx:555` passes it. Rename the done column to "Shipped" and the blocker warning silently vanishes from the list,
  detail sheet, and bulk paths. Server-side `getOpenBlockers` is category-aware, so this is a guard gap, not corruption.
- **M5 — Board drag to a done column never generates the next recurrence.** `generateNextOccurrence` is called only from
  `moveTaskStatus`; `moveAndReorderTask` (the action every cross-column drag uses, `board.tsx:588`) has no recurrence
  handling. A recurring task completed by dragging silently never recurs; completed via the list dropdown it does.
- **M6 — Realtime DELETE payloads for `project_statuses` are not RLS-filtered.**
  `20260824050000` sets `replica identity full` and publishes the table;
  `lib/board/subscribe-board-columns-realtime.ts:44` filters only on `project_id`. Realtime does not run RLS on DELETE, so a
  client can subscribe with an arbitrary project id and receive full OLD rows for a private project. Low-value data, but it
  is an authorization boundary the code claims to hold.
- **M7 — Zero-columns delete has a TOCTOU race (AS-415).** `prevent_last_project_status_delete` counts siblings in its own
  snapshot and `reassign_and_delete_project_status` takes `FOR UPDATE` on the **source** row only. Two concurrent deletes of
  the last two columns lock disjoint rows, each sees the other, both commit → project with zero columns. Needs a lock on the
  parent `projects` row.
- **M8 — Saved-view `groupBy` is stored but never applied (AS-428).** `savedViewConfigSchema.groupBy` persists
  (`lib/validation/views.ts:47`), but nothing on the list page reads it and `ResolvedListViewFilters`
  (`lib/views/resolve-view.ts:41-48`) drops it. Currently vacuous (the list page never writes a `groupBy` param either), so
  it is dead surface rather than a live break — but AS-428's grouping clause is unmet.
- **M9 — Malformed saved-view `config` throws instead of degrading (AS-433).** `lib/actions/views.ts:82` and
  `lib/queries/views.ts:76` do a bare `row.config as SavedViewConfig` with no Zod parse; the DB only constrains
  `jsonb_typeof(config)='object'`. `resolve-view.ts:78` then does `for (const filter of config.filters)`. A `{}` row → unhandled
  500. Mark it default and `list/page.tsx:143-147` redirects you to it on every project open — a self-inflicted permanent
  500; share it and the `?viewId=` link is a stored DoS for other members. Requires hand-crafted PostgREST input, so not
  normal use.
- **M10 — Completed tasks sit in My Tasks' "Overdue" section with no done affordance.** `lib/my-tasks/bucket.ts:18-26`
  deliberately buckets by `due_date` alone, and `my-tasks/page.tsx:204-247` never uses `row.isDone` — no strikethrough, no
  dimming, no filter. A user who completes 40 tasks over a quarter opens their daily-driver screen to a 40-item red
  "Overdue" list.
- **M11 — `bulkUpdateTasks` has no handler for the start/due CHECK.** `lib/actions/tasks.ts:4951` puts `due_date` in the
  payload; :4970 issues one `UPDATE ... .in("id", allowedIds)`; :4977-4983 maps any error to the generic "Something went
  wrong." If any selected task has `start_date > new dueDate`, the CHECK aborts the **whole batch** — no task updates, the
  offender never appears in `failedIds`, and the message is misleading. Atomic, so no corruption. The only UI caller sends
  `status` only today, but a Server Action is a public endpoint and the schema accepts `dueDate`. No test.
- **M12 — Timeline drag on a clipped bar writes a date that doesn't match the drop.** `computeBarLayout`
  (`lib/timeline/layout.ts:176-186`) clamps endpoints to the visible range, but `TimelineBody.handleDragEnd`
  (`components/timeline/timeline-body.tsx:149-190`) applies `deltaDays` to the task's **real** dates. Month zoom, range
  2026-03-01…2026-05-31, task start 2026-01-05 / due 2026-12-20: the bar renders edge-to-edge; the user drags the left handle
  right by 10 day-widths expecting start 2026-03-11, the write is 2026-01-15. The bar is still clipped full-width so nothing
  changes on screen and no error appears — the user repeats the drag and silently walks the date. Untested.
- **M13 — AS-425's only "grouped reorder" test never touches the grouped path.**
  `tests/integration/f225-swimlane-drag-reassign.test.ts:336-357` calls `reorderTask(taskId, 2500)` with a hardcoded literal;
  it never invokes `handleDragEnd`, `parseDndId`, or `calculatePosition`, and would pass if the grouped path computed a
  garbage position or never called the action. `tests/unit/f225-swimlane-drag-reassign.test.ts` is almost entirely
  source-regex assertions (lines 94-95, 99-101, 111-119, 136-155, 175, 201-204) that assert a line of code exists — a rename
  breaks them, a logic inversion does not.
- **M14 — `createTask` still hard-codes the original four statuses.** `lib/validation/tasks.ts:34` is
  `z.enum(["todo","in_progress","in_review","done"])` and `lib/actions/tasks.ts:377` writes that text with no
  `project_statuses` lookup (unlike `moveTaskStatus`, which does). In a project whose defaults were renamed, a new task gets
  `status='todo'`, the trigger's name lookup misses, `status_id` is set NULL, and the task is absent from the board RPCs.
  Same class in `duplicateTask` (:4567) and `restoreTask` (:2031-2062, whose `KNOWN_STATUSES`/`NOT_STARTED_FALLBACK_STATUS`
  are still the fixed four). Gated behind B3 today for default columns, but reachable now for user-added ones.

## Minors

- `lib/views/apply-view.ts` (`buildViewSearchParams`) is dead production code — referenced only by
  `tests/unit/apply-view.test.ts`, which therefore round-trips a path nobody executes.
- `components/dashboard/dashboard-task-table.tsx:31` still hard-codes `VALID_STATUSES`; the workspace-wide table can't filter
  or set a custom column. Documented out of scope in F223.
- `lib/queries/dashboard.ts` module header still claims it densifies status rows — stale since F223's sparse contract. No
  functional impact (`StatusPieChart` filters `count > 0`).
- `20260824060000`'s header says `drop view ... cascade` "also drops the three RPCs". The count is wrong in both directions
  and the claim is wrong in principle — see "Refuted claims" below. Comment-only.
- `components/board/board.tsx:107-119` — `DEFAULT_COLUMNS` is a fixed-four fallback used when `columns` is omitted, which is
  what every board unit test does. Those tests never see real `project_statuses`.
- `lib/actions/board-prefs.ts:90-93` casts `collapsed_lanes` behind only a `typeof === "object"` guard; a JSON array would
  flow unvalidated into `new Set(...)`. Self-written data only.
- `components/board/board.tsx:690-711` fires `upsertBoardSwimlanePrefs` **inside** a `setState` updater — impure, so React
  StrictMode double-writes. Idempotent today.
- `components/timeline/timeline-bar-draggable.tsx:120-127` sets inline `transform` during drag, clobbering the Tailwind
  `-translate-x-1/2 -translate-y-1/2` centering; a dragged marker jumps ~8px and snaps back. Cosmetic.
- `components/timeline/timeline-body.tsx:200-207` renders the project group header as a 224px cell plus a zero-width div, so
  once scrolled right the header row has no background past the sticky column.
- `tests/unit/f240-timeline-zoom.test.ts:170-181` asserts `layout.leftPx === diffCalendarDays(...) * pixelsPerDay`,
  recomputing the implementation's own expression with the same helper instead of a literal.
- No `.limit()`/`.range()` on `getMyTasks`, `getCalendarTasks`, or `getTimelineTasks`; PostgREST's default 1000-row cap would
  truncate silently. Unlikely at current scale.
- `calendar-day-grid.tsx:90` — `membership ? canWrite(...) : true` yields draggable chips when no provider is present.
  Permissive default; provider is present in the real tree.
- My Tasks buckets by due date regardless of done-ness, so on a Sunday the "This week" group is always empty (Monday-start ISO
  week, inclusive Sunday end). Defensible, documented, surprising.
- An invalid profile timezone makes `todayInTimeZone` return null and drops **every** My Tasks row into "Later" rather than
  failing loudly.

## Refuted reviewer claims (recorded so the next pass doesn't chase them)

- **`get_workspace_time_by_person` is NOT dropped by the `cascade`.** A reviewer called this a blocker on the grounds that
  `20260824060000:168` runs `drop view if exists active_project_tasks cascade` and only three of four dependent functions are
  recreated. PostgreSQL does not record dependencies for functions with string-literal (`AS $$...$$`) bodies — only
  SQL-standard `BEGIN ATOMIC` bodies are tracked. All four functions here use `$$` bodies, so the cascade drops nothing.
  Empirical confirmation: `lib/supabase/database.types.ts` was regenerated *after* `20260825010000` (it carries the new
  `get_status_counts` name/colour/category shape) and still lists `get_workspace_time_by_person` at line 1420 — i.e. the live
  DB, which ran this exact migration, still has the function. A from-scratch replay behaves identically. Downgraded to a
  comment-accuracy minor.
- **AS-420 is not "priority-only".** A grep suggesting only the priority branch was wired is misleading;
  `components/board/board.tsx:615-648` dispatches all three groupings to real Server Actions
  (`editTask` / `setTaskAssignees` / `updateTaskTags`), each with server-side authorization. PASS.

## Recommended follow-up features

1. **Fix the calendar grid's stale optimistic state.** Give `<CalendarDayGrid>` an identity that changes when the server data
   changes — a `key` derived from the month key plus the serialized active filters — or replace the `useState` mirror with a
   prop-derived value plus a separate override map for in-flight drags. Add a test that re-renders the component with a second
   month's props and asserts the new month's tasks appear; the current suite mounts fresh every time and cannot catch this
   class. Covers B1 (AS-442, AS-443, AS-448).
2. **Make column identity survive a rename.** Move the board's and list view's task-to-column association off the
   `tasks.status` *text* and onto `status_id` (the RPCs already return it), or propagate renames to `tasks.status` inside
   `updateColumn` / an `after update on project_statuses` trigger. Whichever is chosen, add a test that renames a column
   holding tasks and then re-reads the board and the list status filter. Also align the seeded default colours with
   `COLUMN_COLOR_PALETTE` (or widen the palette to include them) so renaming a default column stops failing validation.
   Covers B2 and B3 (AS-404, AS-411), and removes the root cause of M14.
3. **Add role enforcement to `project_statuses` write RLS.** Extend the INSERT/UPDATE/DELETE policies with a workspace-role
   predicate matching `canManageColumns`, or route all writes through a `SECURITY DEFINER` RPC as F220 already does for
   delete-and-reassign. Add negative tests that attempt the mutation as a `viewer` through a signed-in session client, not
   through the Server Action. Covers B4 (AS-414).
4. **Close the `saved_views` UPDATE hole.** Mirror the INSERT policy's visibility clause into the UPDATE `WITH CHECK`, and
   additionally pin `workspace_id`/`project_id` as immutable after creation. Add an RLS test that PATCHes an owned row's
   `project_id`/`workspace_id` to values outside the caller's visibility and asserts rejection. Covers B5 (AS-434).
5. **Make "No grouping" an explicit URL state.** Change `board-toolbar.tsx` to `params.set("groupBy", "none")`, matching what
   `board.tsx`'s own comment already documents, and add a test that drives the toolbar's `handleChange("none")` with a
   persisted non-none preference and asserts the resolved `groupBy`. Covers B6 (AS-419).
6. **Correctness sweep across the M16 read paths (majors).** One feature covering: the `.eq("is_watching", true)` filter in
   `lib/queries/my-tasks.ts` (M1); threading `nextStatusCategory` into the three blocked-done-guard call sites that omit it
   (M4); recurrence generation on the `moveAndReorderTask` path (M5); Zod-parsing `saved_views.config` on read with a safe
   empty-config fallback (M9); and applying `deltaDays` to clipped timeline bars relative to the rendered (clamped) edge
   rather than the real date, or suppressing resize handles on clipped bars (M12).

## Toolchain output

```
### npx tsc --noEmit

[exited with code 0]
(exit 0, no output)

### npx eslint .

/Users/sasajapranin/Desktop/pm-app/lib/queries/search.ts
  280:27  warning  '_titleMatches' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/invite-member-pagination.test.ts
  186:22  warning  '_columns' is defined but never used  @typescript-eslint/no-unused-vars

✖ 2 problems (0 errors, 2 warnings)


[exited with code 0]

### npx vitest run --dir tests/unit
       |                             ^
     11|
     12|   return createServerClient(
 ❯ getMentionCandidates lib/actions/comments.ts:1372:26
 ❯ components/task/comment-list.tsx:283:5
 ❯ Object.react_stack_bottom_frame node_modules/react-dom/cjs/react-dom-client.development.js:25989:20
 ❯ runWithFiberInDEV node_modules/react-dom/cjs/react-dom-client.development.js:874:13
 ❯ commitHookEffectListMount node_modules/react-dom/cjs/react-dom-client.development.js:13249:29
 ❯ commitHookPassiveMountEffects node_modules/react-dom/cjs/react-dom-client.development.js:13336:11
 ❯ commitPassiveMountOnFiber node_modules/react-dom/cjs/react-dom-client.development.js:15484:13

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
Serialized Error: { __NEXT_ERROR_CODE: 'E251' }
This error originated in "tests/unit/user-avatar.test.tsx" test file. It doesn't mean the error was thrown inside the file itself, but while it was running.
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯


 Test Files  1 failed | 125 passed (126)
      Tests  2 failed | 988 passed (990)
     Errors  1 error
   Start at  13:51:44
   Duration  26.02s (transform 3.27s, setup 0ms, import 62.94s, tests 15.18s, environment 11.28s)


[exited with code 0]
```

### Targeted M16 integration runs
```
f219 + f220 + rls-saved-views:            3 files passed, 34 tests passed
f230 + f231 + f235-calendar-filters:      3 files passed, 22 tests passed
f232 + f234 + f237 + f239:                4 files passed, 28 tests passed
f221/f222/f223/f224/f226/f228/f229 batch: 4 failed | 3 passed  (auth rate limit)
  re-run individually:
    f221-board-custom-columns              1 file passed,  7 tests passed
    f222-status-category-semantics         1 file passed,  8 tests passed
    f224-board-swimlane-grouping           1 file passed,  2 tests passed
    f229-saved-views-ui                    1 file passed,  8 tests passed
```

Unit failures are the two known pre-existing `tests/unit/trash-list.test.tsx` cases (router mock, M14). Lint warnings are the two known pre-existing ones.
