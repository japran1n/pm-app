# M16 — Views: scrutiny report (PASS 2, FINAL)

Scope: F218–F240, F324 (commits mislabeled "F241"), F325, F326.
Assertions AS-403–AS-458. Migrations `20260824010000` … `20260828040000`.
Pass 1 (6 blockers / 14 majors / 13 minors) is preserved at `git show 6b7fbea:missions/20260818-213033/milestones/M16-scrutiny.md`.

Method: three parallel per-area reviewers reading code/SQL only (no handoffs passed in),
plus **independent live adversarial probing of the linked Supabase project**
(`qcipqonnqajmazdbysow`) by this validator — real users created via the admin API, real
sign-in with the publishable key, real direct PostgREST writes as `viewer`, `guest`,
project `lead`, and workspace `owner`. Probe scripts were run from the repo root and
deleted afterwards; no repo file was modified.

Toolchain: `npx tsc --noEmit` clean (exit 0, no output — independently confirmed, the
F326 handoff's corrected claim holds). `npx eslint .` 0 errors, 2 known pre-existing
warnings. `npx vitest run --dir tests/unit` 129 files / 995 tests, 1 file / 2 tests failed
= the known pre-existing `tests/unit/trash-list.test.tsx`. All 11 M16 integration files
green when run individually (f219 13, f220 7, f221 7, f222 8, f223 7, f325 3, f326 7,
rls-saved-views 14, f229 8, f232 7, f235 7).

## Verdict: **NOT GREEN — 1 blocker.**

Five of the six pass-1 blockers are genuinely fixed and were verified against the live
database, not against the handoffs. The sixth (calendar) is fixed for its stated failure
mode with a residual defect recorded as a major. **One new blocker was introduced by the
F326 fix**, and it is the exact failure mode the assignment warned about: a fix that
closes a hole by tightening a policy whose justification rests on a factually wrong claim
about which client the application writes with.

---

## Verification of the six pass-1 blockers

| Pass-1 blocker | Assertions | Verified how | Result |
|---|---|---|---|
| B1 calendar staleness | AS-442/443/448 | code trace + reviewer + test-revert analysis | **FIXED** for month nav and filter change; residual at unchanged key (MAJ-1) |
| B2 rename strands tasks | AS-411 | live DB: renamed a seeded column holding live + soft-deleted tasks | **FIXED** — `tasks.status` propagated, `status_id` still pinned to the same column |
| B3 default columns unrenameable | AS-404 | live DB: seeded colours now `#64748b/#3b82f6/#d97706/#16a34a`, all in `COLUMN_COLOR_PALETTE` | **FIXED** for seeded rows; root cause untouched (MAJ-2) |
| B4 viewer can mutate columns | AS-414 | **live direct PostgREST as a signed-in viewer**: INSERT `42501`, UPDATE 0 rows, DELETE 0 rows, DB state unchanged | **FIXED** — but over-tightened, see BLOCKER-1 |
| B5 saved_views cross-tenant PATCH | AS-434 | live direct PostgREST as owner: relocation PATCH `42501`, `workspace_id` unchanged; legitimate rename + config PATCH still succeed (1 row each) | **FIXED** |
| B6 "No grouping" unreselectable | AS-419 | `components/board/board-toolbar.tsx:62` now `params.set("groupBy", value)` unconditionally; `board.tsx:669-675` resolution was already correct | **FIXED** |

---

## Assertion table

Verdicts carried forward from pass 1 where the code is untouched; every row touched by
F325/F326 was re-verified from scratch.

| ID | Verdict | Reason |
|---|---|---|
| AS-403 | PASS | Per-project `project_statuses` with FK + RLS; board/list/search all read it. |
| AS-404 | **FAIL (blocker)** | Default-column rename now works (B3 fixed, verified live), but F326's RLS tightening breaks add/rename/reorder for **project leads** — BLOCKER-1. Also MAJ-2. |
| AS-405 | PASS | colour + `category` CHECK in DB and Zod. Seed recolour did not touch any user-chosen colour (MIN-1). |
| AS-406 | PASS | `reassign_and_delete_project_status` moves tasks + deletes in one transaction. Orphan produced by a *different* path — MAJ-3. |
| AS-407 | PASS | `projects_seed_default_statuses` AFTER INSERT trigger; `CREATE OR REPLACE` preserved binding, `security definer`, `search_path`, and ACL. Verified live: a new project seeds 4 columns with the new palette colours. |
| AS-408 | PASS | Backfill matched on `(project_id, name)` before the sync trigger existed. |
| AS-409 | PASS | `moveAndReorderTask` re-verifies the name against `project_statuses`. |
| AS-410 | PASS | `is_done_status()` / `status-category.ts` at every reachable site. Caveat MAJ-8 (carried from pass-1 M4). |
| AS-411 | **PASS** | Live: renamed a column holding a live task and a soft-deleted task; both rows' `status` became the new name, `status_id` unchanged, list-filter shape returns them. B2 genuinely closed. |
| AS-412 | PASS | `get_status_counts` groups on `coalesce(ps.name, t.status)`. |
| AS-413 | PASS | Realtime channel + reducer correct. Caveat MAJ-9 (carried, DELETE payloads unfiltered). |
| AS-414 | **PASS** | Live direct-PostgREST as viewer: INSERT `42501`; UPDATE/DELETE affect 0 rows; admin re-read shows `todo,in_progress,in_review,done` intact. A project `lead` (workspace role `member`) is also blocked — correct for AS-414, but see BLOCKER-1. |
| AS-415 | PASS | `prevent_last_project_status_delete` holds. Caveat MAJ-10 (TOCTOU, carried). |
| AS-416 | PASS | `getProjectColumns` orders by `position` server-side. |
| AS-417 | PASS | Search resolves name via `status_id`. One expectation in `f223-…test.ts` was legitimately updated by F325 because the fix changes the premise; the AS-417 intent (resolve via join, not hand-built props) is intact. |
| AS-418 | PASS | `groupTasksIntoSwimlanes` handles assignee/priority/tag. |
| AS-419 | **PASS** | `board-toolbar.tsx:62` writes explicit `groupBy=none`; `tests/unit/f325-board-toolbar-groupby-none.test.tsx` fails on revert. |
| AS-420 | PASS | Cross-lane drops call real actions; auth server-side. |
| AS-421 | PASS | Each lane counts its own slice. |
| AS-422 | PASS | `board_swimlane_prefs`, own-row RLS, both FKs cascade. |
| AS-423 | PASS | `SWIMLANE_NONE_KEY` sentinel lane. |
| AS-424 | PASS | Per-(user, project) read-merge upsert. |
| AS-425 | PASS (untested) | Position maths uses global neighbours. No test exercises the grouped drag path — MIN-6 (carried M7). |
| AS-426 | PASS | Filters/sort/grouping persist in `config`. |
| AS-427 | PASS | `scope` CHECK + distinct SELECT branches. Creation of a `shared` view is unrestricted by role at both layers — MAJ-4. |
| AS-428 | **FAIL (major)** | Carried from pass 1: `groupBy` is stored but never read or applied by the list page. Untouched by F325/F326. |
| AS-429 | PASS | SELECT uses `is_project_visible_to`. |
| AS-430 | PASS | Verified live: UPDATE/DELETE both pin `owner_id = auth.uid()` at the DB layer; the admin-not-owner exception routes through the admin client after `canManageSavedView`. `is_default` is per-owner and cannot be forced on another user's row. |
| AS-431 | PASS | `set_saved_view_default` service-role only. |
| AS-432 | PASS | `getSavedView` RLS-scoped and pins `projectId`. |
| AS-433 | **FAIL (major)** | Carried: `row.config as SavedViewConfig` with no Zod parse. Now *more* reachable — see MAJ-4. |
| AS-434 | **PASS** | Live: viewer PATCH of own row to `workspace_id=<foreign>, project_id=null, scope=shared` returns `42501`; admin re-read confirms the row unmoved. Partial gap at MAJ-5. |
| AS-435 | PASS | RLS session client, filter-only `!inner` embed, workspace-scoped. |
| AS-436 | PASS | Timezone-correct string bucketing. Caveat MAJ-11 (carried M10). |
| AS-437 | PASS | Both archive filters applied on both queries. |
| AS-438 | PASS | Real `moveTaskStatus`, target column `.eq("project_id", …)`. |
| AS-439 | PASS | `projectName` from an RLS-permitted embed. |
| AS-440 | PASS | Real zero-row path drives headline + explainer + CTA. |
| AS-441 | **FAIL (major)** | Carried: `lib/queries/my-tasks.ts:175-178` omits `.eq("is_watching", true)`. One-line fix, still unfixed. |
| AS-442 | PASS | Grid renders the correct month on load and after nav. Residual: the `byDate` mirror can never accept fresh server data at an unchanged `dataKey` — MAJ-1. |
| AS-443 | **PASS** | `dataKey` = month key + filter suffix; `<CalendarDayGrid key={dataKey}>` remounts on month nav. `tests/unit/f326-month-grid-datakey-wiring.test.tsx` fails on revert. |
| AS-444 | PASS | Real `?taskId=` deep link from chip and overflow popover. |
| AS-445 | PASS | Optimistic set → real `editTask` → rollback + single toast. Unmount-mid-flight nuance is MIN-3. |
| AS-446 | PASS (misleading) | Carried MAJ-12: undated count ignores active filters. |
| AS-448 | **PASS** | `calendar/page.tsx` reads exactly `month/status/priority/assigneeId/projectId`; `filterQuery` sets all four non-month ones and feeds `dataKey`. No filter can change without changing the key. Test coverage gap at MIN-2. |
| AS-449 | INCONCLUSIVE | Carried MAJ-13: only proof is a className-mirror unit test plus a Playwright spec blocked by the known-broken login helper. |
| AS-450 | PASS | One `getCurrentUserTimezone` feeds default month and `isToday`. |
| AS-451 | PASS | `computeBarLayout` emits inclusive-width range bars. |
| AS-452 | PASS | Null start collapses to a one-day marker. |
| AS-453 | PASS | Real DB CHECK `tasks_start_date_not_after_due_date`. Caveat MAJ-14 (carried M11, `bulkUpdateTasks`). |
| AS-454 | PASS | Drag/resize routes through `editTask`; `canDrag` is cosmetic. |
| AS-455 | PASS | `getTimelineDependencyEdges` RLS-scoped, both endpoints constrained; `20260828020000` two-sided fix verified. |
| AS-456 | PASS | Zoom changes pixels/day, tick granularity, and the fetched range. |
| AS-457 | PASS | Today line from the profile timezone; omitted, not clamped, when out of range. |
| AS-458 | PASS | Single `overflow-x-auto` container; sticky name column inside it. |

---

## BLOCKER

### BLOCKER-1 — F326's RLS tightening silently breaks board-column management for project leads (AS-404; regression introduced by the fix for AS-414)

**The migration's central justification is factually false.**
`supabase/migrations/20260828040000_rls_hardening_project_statuses_and_saved_views.sql:29-38`
states: *"every real write path (lib/actions/statuses.ts, …) writes through
`createAdminClient()` or is itself `security definer`, both of which bypass RLS entirely,
so a project lead's Server Action writes are UNAFFECTED by this tightening."*

`lib/actions/statuses.ts:6-15` says the opposite in its own header — *"the request-scoped,
RLS-respecting client (`supabase`) performs every actual write … `createAdminClient()` is
used ONLY for read-only lookups"* — and the code agrees:

| action | mutation | client |
|---|---|---|
| `addColumn` | `lib/actions/statuses.ts:225` `supabase.from("project_statuses").insert(...)` | **session (RLS)** |
| `updateColumn` | `lib/actions/statuses.ts:308` `supabase…update({name,color,category})` | **session (RLS)** |
| `reorderColumn` | `lib/actions/statuses.ts:404` `supabase…update({position})` | **session (RLS)** |
| `removeColumn` | `lib/actions/statuses.ts:496` `supabase…delete()` | **session (RLS)** |
| `removeColumnWithReassignment` | `lib/actions/statuses.ts:612` `admin.rpc(...)` | admin + SECURITY DEFINER — unaffected |
| seed-on-project-insert | `20260824010000:152-168` | SECURITY DEFINER — unaffected |
| F325 rename-sync trigger | `20260828030000:60-75` | SECURITY DEFINER — unaffected |

`canManageColumns` (`lib/auth/permissions.ts:70-74`) returns **true for a project `lead`**
whose workspace role is only `member`, and the settings page renders the manager with the
controls enabled for exactly that population:
`app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/columns/page.tsx:80`
`const canManage = canManageColumns({ role: workspaceRole, projectRole });` → `:131`
`<StatusManager … />`.

**Failure scenario (normal use, no devtools):** Dana is a workspace `member` and the `lead`
of project P. She opens Project → Settings → Columns. The page renders every control
enabled. She clicks "Add column", types "QA", saves. `authorizeColumnManagement`
(`statuses.ts:123-155`) passes. The insert at `statuses.ts:225` is then rejected by
`project_statuses_insert_admin`, because `is_project_workspace_admin` is false for her.
`addColumn` returns `{ok:false, error: GENERIC_ERROR}` and the UI toasts **"Something went
wrong."** Identical for rename (`status-manager.tsx:114` → `updateColumn`) and reorder
(`status-manager.tsx:406` → `reorderColumn`). Delete happens to survive only because the UI
calls `removeColumnWithReassignment`, the one action that uses the admin client.

**Independently verified live.** I created a workspace with an `owner`, a `viewer`, and a
`member` who holds a `project_members.project_role = 'lead'` row on the project, signed each
in with the publishable key, and attempted direct PostgREST writes:

```
== AS-414 direct PostgREST as VIEWER ==
 insert: BLOCKED (42501)
 update: rows affected=0
 delete: rows affected=0
 DB state after viewer attempts: todo,in_progress,in_review,done

== project LEAD (workspace role=member) direct PostgREST ==
 insert: BLOCKED (42501 new row violates row-level security policy for table "project_statuses")
 reorder update: rows=0
```

The viewer block is the AS-414 fix working. The lead block is the regression: since
`addColumn`/`updateColumn`/`reorderColumn` execute on exactly this RLS-scoped connection,
the second block *is* what happens inside the Server Action.

**Why no test caught it:** every column-management integration test seeds through
`adminClient` and drives the actions as an owner or asserts a viewer's `{ok:false}`. No test
exercises a project lead through `addColumn`. `f219-status-management.test.ts` (13 tests),
`f326-rls-hardening.test.ts` (7 tests) and the rest are all green while this is broken.

**Fix (either, not both):** switch the four writes at `statuses.ts:225/308/404/496` to
`admin` — matching `removeColumnWithReassignment`'s existing seam and the header's stated
"RLS is defense in depth, not the sole gate" intent — **or** extend
`is_project_workspace_admin` to also return true for
`project_members.project_role = 'lead'`. The first is smaller and keeps a single
authorization source (`canManageColumns`); the second keeps RLS as a real second gate.
Whichever is chosen, the fix needs a test that drives `addColumn`/`updateColumn`/
`reorderColumn` **as a project lead through the Server Action**, since that is precisely the
seam neither existing suite covers.

---

## Majors

- **MAJ-1 — The calendar grid can never accept fresh server data at an unchanged `dataKey` (AS-442).**
  `components/calendar/calendar-day-grid.tsx:100` `const [byDate, setByDate] = useState(tasksByDate)`
  is a full mirror initialized once; only a `key` change re-initializes it, and `dataKey`
  (`calendar/page.tsx:174`) changes only on month/filter navigation. `editTask`
  (`lib/actions/tasks.ts:1604`) calls `revalidatePath('/w/<slug>','layout')`, so a fresh RSC
  payload arrives at the same key and is discarded — harmlessly today, because it agrees
  with the optimistic mirror. It stops being harmless the moment a second viewer reschedules
  a task, or any component mounted on this route calls `router.refresh()` (the pattern
  already used at `components/task/new-task-dialog.tsx:203,210` and
  `components/views/view-switcher.tsx:71`, neither currently on the calendar route). The
  correct end state is prop reconciliation guarded by a pending-drag id/version, not a
  remount key.
- **MAJ-2 — B3 was fixed as data, not as logic; any out-of-palette colour still permanently locks rename (AS-404).**
  `lib/actions/statuses.ts:255-259` re-parses the whole payload through
  `updateColumnSchema`, and `status-manager.tsx:164` submits the row's **current, unchanged**
  colour on a rename, so `columnColorSchema` (`lib/validation/statuses.ts:22-24`) rejects a
  rename over a field the user never touched. The migration's three UPDATEs
  (`20260828030000:135-145`) only repair rows matching an exact (name, colour) seed pair. Any
  row with a non-palette colour written by the admin client, a fixture, a future support
  script, or an older seed remains un-renameable forever — e.g. the columns
  `tests/integration/f222-status-category-semantics.test.ts:203-228` creates at `#22c55e` /
  `#f59e0b`. The root cause (validating a field the action was not asked to change) is
  untouched.
- **MAJ-3 — Renaming a column plus restoring a trashed task produces a column-less task (AS-406-adjacent; enabled by F325).**
  The rename trigger (`20260828030000:66-69`) has **no `deleted_at` filter** — confirmed live:
  a soft-deleted task's `status` was rewritten to the new column name. `restoreTask`
  (`lib/actions/tasks.ts:2031-2039`) then hard-codes
  `KNOWN_STATUSES = ["todo","in_progress","in_review","done"]` and resets anything outside
  that set to `"todo"`. Scenario: task T is trashed while in "todo"; an admin renames "todo"
  → "Backlog"; T's status becomes "Backlog"; the user restores T; `statusWasReset` is true, so
  restore forces `status='todo'` — **a column that no longer exists in the project**.
  `sync_task_status_and_status_id` (`20260824010000:213-219`) `SELECT INTO`s no row and sets
  `status_id = NULL`. T renders in no board column (`board.tsx:792` groups by `column.name`)
  and matches no option in the list status filter. Recoverable via the list view's inline
  status editor, so not corruption — but it is a task in no column produced by two supported
  admin actions. Fix `restoreTask` to resolve a real `project_statuses` row
  (`category='not_started'`, lowest position) instead of a literal; the same hard-code exists
  in `createTask`/`duplicateTask` (the F325 handoff's own "M14" note).
- **MAJ-4 — Any viewer or guest can create a *shared, default* saved view via direct PostgREST, and combined with AS-433 that is a stored DoS (AS-427, AS-430, AS-433).**
  Verified live: signed in as a `viewer`, `POST /saved_views` with
  `{scope:'shared', is_default:true, config:{}}` succeeded, and the row was then **visible to
  the workspace owner** on read-back. Neither `saved_views_insert_visible`
  (`20260826010000:127-137`) nor `createSavedView` (`lib/actions/views.ts:286`) constrains
  `scope` by role. This is the same class of hole F326 set out to close for
  `project_statuses` and was left open on the sibling table. It also promotes pass-1's M9
  (AS-433) from "requires hand-crafted input" to a real attack: `config:{}` is not Zod-parsed
  (`lib/actions/views.ts:82`, `lib/queries/views.ts:76`), `resolve-view.ts:78` iterates
  `config.filters`, and a shared **default** view is auto-opened by `list/page.tsx:143-147`
  for every member — a permanent 500 on the project's list page from one PostgREST call.
  Fix both: role-gate `scope='shared'` in RLS + the action, and Zod-parse `config` on read
  with a safe fallback.
- **MAJ-5 — B5 is only partially closed: `workspace_id` is still unvalidated on `saved_views` UPDATE when `project_id` is set (AS-434).**
  The new `with check` (`20260828040000:121-126`) is
  `(project_id is not null and is_project_visible_to(project_id)) or (project_id is null and is_active_workspace_member(workspace_id))`.
  The `or` short-circuits on the project branch, so a caller can PATCH their own row's
  `workspace_id` to a foreign workspace while keeping a visible `project_id`. Blast radius is
  small — `saved_views_select_visible`'s workspace branch requires `project_id is null`, so
  the row is not surfaced to the foreign tenant — but it defeats the app-layer
  `WORKSPACE_MISMATCH_ERROR` guard (`lib/actions/views.ts:259-261`) that exists to keep the
  pair consistent, and any future query trusting `workspace_id` alone inherits the mismatch.
  Add `and workspace_id = (select workspace_id from projects where id = project_id)` to the
  project branch.
- **MAJ-6 — Renaming a column bumps `updated_at` and fires a realtime broadcast for every task in it (AS-411).**
  Confirmed live: `updated_at_changed=true` after the rename.
  `20260818023746_tasks_updated_at_exclude_position.sql:19-36`'s WHEN clause includes
  `old.status is distinct from new.status`. Renaming a 500-task column touches all 500 rows →
  500 realtime `tasks` UPDATE events (`20260818040000:27`) plus the `project_statuses` one, and
  every "recently updated" ordering is flooded with rows nobody edited, with **no**
  `task_activity` row explaining why (verified live: `task_activity`, `notifications`, and
  `audit_log` deltas were all 0). Not corruption; unbounded noise. Consider excluding this
  trigger's writes or batching the realtime notification.
- **MAJ-7 — Latent cross-project corruption in the rename trigger's primary clause (AS-411).**
  `20260828030000:68` matches `status_id = new.id` with **no** `project_id` guard, while the
  fallback clause at `:69` correctly scopes by project. `sync_task_status_and_status_id`
  (`20260824010000:205-231`) only re-derives when `status` or `status_id` changed — never on a
  `project_id`-only change — so a task moved between projects would keep a foreign
  `status_id` and be rewritten by the other project's rename. No reachable cross-project move
  exists today (`tasks.project_id` is written only at insert, `lib/actions/tasks.ts:374`, and
  duplicate, `:4592`), so this is latent, not exploitable. One-line guard:
  `status_id = new.id and project_id = new.project_id`.
- **MAJ-8 (carried, pass-1 M4) — Blocked-done guard is not category-aware at 3 of 4 call sites (AS-410).** `components/task/blocked-done-guard.tsx:98` falls back to literal `status === "done"`; `list-status-select.tsx:109`, `task-detail-sheet.tsx:724`, `bulk-status-action.tsx:72` omit `nextStatusCategory`. Now *more* reachable, since F325 makes renaming the done column actually work.
- **MAJ-9 (carried, pass-1 M6) — Realtime DELETE payloads for `project_statuses` are not RLS-filtered.** `20260824050000` sets `replica identity full`; `lib/board/subscribe-board-columns-realtime.ts:44` filters only on `project_id`.
- **MAJ-10 (carried, pass-1 M7) — Zero-columns delete TOCTOU (AS-415).** `reassign_and_delete_project_status` takes `FOR UPDATE` on the source row only; two concurrent deletes of the last two columns lock disjoint rows. Needs a lock on the parent `projects` row.
- **MAJ-11 (carried, pass-1 M10) — Completed tasks sit in My Tasks' "Overdue" section.** `lib/my-tasks/bucket.ts:18-26` buckets by `due_date` alone; `my-tasks/page.tsx:204-247` never reads `row.isDone`.
- **MAJ-12 (carried, pass-1 M2) — Undated calendar count ignores active filters (AS-446).** `calendar/page.tsx:145`.
- **MAJ-13 (carried, pass-1 M3) — AS-449 has no runnable behavioural proof.** `tests/unit/f235-calendar-responsive-render.test.tsx:51-87` asserts Tailwind class strings.
- **MAJ-14 (carried, pass-1 M11) — `bulkUpdateTasks` has no handler for the start/due CHECK.** `lib/actions/tasks.ts:4951-4983`.
- **MAJ-15 (carried, pass-1 M1) — Watched tasks include tasks the user explicitly unwatched (AS-441).** `lib/queries/my-tasks.ts:175-178` omits `.eq("is_watching", true)`. One-line fix; still the cheapest open major in the milestone.
- **MAJ-16 (carried, pass-1 M8) — Saved-view `groupBy` stored but never applied (AS-428).** `lib/views/resolve-view.ts:41-48` drops it.
- **MAJ-17 (carried, pass-1 M5) — Board drag to a done column never generates the next recurrence.** `generateNextOccurrence` is called only from `moveTaskStatus`, not `moveAndReorderTask`.

## Minors

- **MIN-1 — The seed-colour data UPDATEs are unscoped by project, category, and "is a default".** `20260828030000:135-145` runs `where name='todo' and color='#94a3b8'` globally, with no `category` predicate and no seeded-row marker. I could construct no UI-reachable false positive (the three old hexes are not in `COLUMN_COLOR_PALETTE`, `lib/board/column-colors.ts:22-31`, so no user could ever have chosen one) — the migration's "preserves deliberate customisation" claim is **true, but only by accident** of which hexes happen to be unreachable, not by construction. It would also recolour a column named `done` whose category the user deliberately set to `in_progress`.
- **MIN-2 — `tests/unit/f326-calendar-day-grid-rerender.test.tsx:59-116` cannot fail if the fix is reverted.** It renders `CalendarDayGrid` directly and supplies its own `key` in `createElement` props (lines 62, 76, 94, 105) — it tests React's `key` semantics, not the product wiring. Deleting `key={dataKey}` from `month-grid.tsx` leaves all three cases green. Only `f326-month-grid-datakey-wiring.test.tsx:38-70` is a real guard, and it exercises a **month** change only; there is no same-month/different-filter case, which is exactly AS-448's shape. Add one: identical `grid`, `dataKey` `"2026-06"` → `"2026-06&assigneeId=u1"`, different `tasksByDate`.
- **MIN-3 — Remount mid-drag loses the visual rollback (AS-445).** `calendar-day-grid.tsx:117-152`: if the user navigates while `editTask` is in flight, the `key` change unmounts the instance, so `setByDate(snapshot)` at `:141` is a no-op while `toast.error` at `:142` still fires. The single-toast guarantee holds and the remounted grid renders correct server data, so the outcome is right; worth a comment.
- **MIN-4 — Test 3 in `f326-calendar-day-grid-rerender.test.tsx:118-150` locks in the wrong rule.** It *asserts* that a fresh `tasksByDate` at an unchanged key must be discarded ("Incidental task" must not appear). MAJ-1's correct fix — reconcile on prop change while preserving an in-flight drag — is now a test-breaking change. The safety it protects is real; the assertion is too broad.
- **MIN-5 — Policy-rename re-apply hazard.** `20260828040000` creates `project_statuses_{insert,update,delete}_admin` under **new names**, so if `20260824010000` were ever replayed out of order its permissive `_visible` policies would be recreated *alongside* the `_admin` ones and, being permissive (OR'd), would fully reopen AS-414. A normal ordered `db reset` is fine. Prefer replacing policies under the same name.
- **MIN-6 — `is_project_workspace_admin` does not check `p.deleted_at is null`,** so a workspace admin can mutate columns of a trashed project via the direct path. `is_project_visible_to` has the same omission, so this is consistent and pre-existing, not introduced here.
- **MIN-7 — `grant execute … to anon` on `is_project_workspace_admin` (`20260828040000:71`) is unnecessary** (no `anon` policy on `project_statuses`). Confirmed *not* an existence oracle: `is_workspace_admin` compares `wm.user_id = auth.uid()`, which is NULL for `anon`, so both real and fake project ids return `false`.
- **MIN-8 — Stale references to the old seed hexes.** `lib/queries/dashboard.ts:164` still hard-codes `#94a3b8` as a colour fallback (dead — `project_statuses.color` is `NOT NULL`, `20260824010000:36`), and `tests/unit/board-columns-realtime.test.ts:108,140` still use it as a fixture colour. Neither breaks; both are now inconsistent with the seed.
- **MIN-9 through MIN-13** — pass-1's remaining minors are unchanged and are not restated; see `git show 6b7fbea:missions/20260818-213033/milestones/M16-scrutiny.md`.

---

## Explicitly refuted claims

These were checked adversarially and found **not** to be defects, contrary to plausible suspicion:

- *"The rename trigger will be rejected by a CHECK on `tasks.status`."* No. `tasks_status_check` (the fixed-four CHECK, `20260818013434_create_tasks.sql:34`) was dropped and replaced by `tasks_status_not_empty` at `20260824020000_project_statuses_management.sql:37-40`. Verified live: renaming a column to `"Shipped <rnd>"` succeeded.
- *"The trigger can recurse or fight `sync_task_status_and_status_id`."* No. Verified live: `status_id` remained pinned to the same column row after rename. The AFTER trigger sees the committed new name, and the `(project_id, name)` unique index guarantees at most one match.
- *"A two-column name swap corrupts tasks."* No. Verified live: renaming a column to an existing sibling's name is rejected `23505` by the unique index **before** the AFTER trigger fires; the whole statement rolls back.
- *"The rename triggers an activity/notification storm."* No activity or notification rows are written — verified live, `task_activity`/`notifications`/`audit_log` deltas were all 0. (The `updated_at`/realtime noise is real — MAJ-6.)
- *"F220's `reassign_and_delete_project_status` fights the new trigger."* No. `20260824040000:39-101` never writes `project_statuses.name`, so the `after update of name` trigger does not fire inside it; lock order is identical in both paths.
- *"A workspace owner loses column management on a private project they are not a member of."* No. Verified live: a workspace owner who is not a `project_members` row successfully renamed a column on a `visibility='private'` project via the direct path (1 row affected). `is_project_visible_to` grants owner/admin access regardless of project membership, so the two conjuncts are satisfied by the same population.
- *"`dataKey` omits a filter."* No. `calendar/page.tsx:63-77` declares exactly `month/status/priority/assigneeId/projectId`; `filterQuery` (`:157-162`) sets all four non-month ones. `resolveCalendarFilters` and `CalendarFilters` handle the same four and nothing else.
- *"The mobile agenda fallback goes stale too."* No. `AgendaList` has no `"use client"` and no `useState` — it is a pure server render.
- *"A stale/duplicate permissive policy survives on `project_statuses` or `saved_views`."* No. Full grep of all migrations: the only policies on either table are the four in `20260824010000` and the four in `20260826010000`; the hardening migration drops exactly the right three/one by their exact names.
- *"`is_default` can be forced on another user's saved view."* No. UPDATE/INSERT both pin `owner_id = auth.uid()` and `saved_views_owner_default_per_project_idx` (`20260826010000:93`) is per-owner.
- *"The F326 handoff's `tsc` claim is false again."* No — the corrected claim holds. `npx tsc --noEmit` exits 0 with no output, independently confirmed.

---

## Recommended follow-up features

1. **Restore project-lead board-column management.** Change the four `project_statuses` mutations in `lib/actions/statuses.ts` (lines 225, 308, 404, 496) from the RLS-scoped session client to `createAdminClient()`, matching the seam `removeColumnWithReassignment` already uses at line 612 and the RLS-as-defense-in-depth intent the file header states — or, alternatively, extend `is_project_workspace_admin` to also return true for a `project_members.project_role = 'lead'` row. Also correct the false claim in `20260828040000`'s header comment. Must ship with an integration test that signs in a workspace `member` holding a project `lead` row and drives `addColumn`, `updateColumn`, and `reorderColumn` **through the Server Actions**, asserting real DB state — the seam neither `f219-status-management.test.ts` nor `f326-rls-hardening.test.ts` covers today. This is the milestone's only blocker.
2. **Make restore, create, and duplicate resolve a real board column instead of a hard-coded literal.** `restoreTask` (`lib/actions/tasks.ts:2031-2039`), `createTask` and `duplicateTask` all reference the fixed four `todo/in_progress/in_review/done` names. Replace each with a lookup of the project's real `project_statuses` row (`category='not_started'`, lowest `position`, falling back to lowest position overall) and write both `status` and `status_id`. Tests: restore a task that was trashed while in a since-renamed column, and create a task in a project whose columns have all been renamed; assert in both cases that `status_id` is non-null and the task appears under a real column in the board query.
3. **Reconcile the calendar grid's optimistic mirror with fresh props instead of relying on a remount key.** Replace `calendar-day-grid.tsx`'s `useState(tasksByDate)` mirror with a derive-from-props value overlaid by a small pending-drag override map keyed by task id (the shape `components/timeline/timeline-body.tsx` already uses successfully), clear the override when the server data agrees or the action settles, and drop `dataKey` if it becomes redundant. Update `tests/unit/f326-calendar-day-grid-rerender.test.tsx` test 3, which currently asserts the over-broad "discard all fresh data at an unchanged key" rule, and add the missing same-month/different-filter wiring case for AS-448.
4. **Role-gate shared saved views and Zod-parse `config` on read.** Add a role predicate to `saved_views_insert_visible` and to the new UPDATE `with check` so `scope='shared'` requires a non-viewer/non-guest, mirroring `canManageSavedView`; tighten the UPDATE project branch to also pin `workspace_id` to the project's own workspace (MAJ-5). Separately, replace the bare `row.config as SavedViewConfig` casts at `lib/actions/views.ts:82` and `lib/queries/views.ts:76` with `savedViewConfigSchema.safeParse`, degrading to an empty config and a non-fatal warning on failure, so a malformed shared default view cannot 500 a project's list page. Tests must drive the direct PostgREST path as a signed-in viewer.
5. **Stop the rename fan-out from being treated as user edits.** Make `sync_tasks_status_on_column_rename` avoid bumping `tasks.updated_at` (e.g. set a `session_replication_role`-style guard or exclude the trigger's writes from the `updated_at` WHEN clause), and add the missing `and project_id = new.project_id` guard to its primary match clause (MAJ-6, MAJ-7). Test with a 100-task column: assert `updated_at` is unchanged for every task after the rename, and that `status`/`status_id` still propagate.
6. **Decouple rename validation from unchanged fields.** `updateColumn` should accept and validate only the fields the caller actually changed, so a legacy or admin-written out-of-palette colour can never block a rename (MAJ-2). Test by inserting a column at a non-palette hex via the admin client, then renaming it through the real action.
7. **Sweep the carried majors.** MAJ-15 (`.eq("is_watching", true)` in `lib/queries/my-tasks.ts:175`) is a one-line fix and the highest value-per-effort item open. Group it with MAJ-8 (blocked-done guard call sites), MAJ-16 (apply saved-view `groupBy`), MAJ-17 (recurrence on board drag), MAJ-11 (done tasks in Overdue), MAJ-12 (filtered undated count), MAJ-14 (`bulkUpdateTasks` CHECK handler), MAJ-10 (lock the parent `projects` row) and MAJ-9 (realtime DELETE filtering).

---

## Full toolchain output

### `npx tsc --noEmit`
```
(no output, exit 0)
```

### `npx eslint .`
```
/Users/sasajapranin/Desktop/pm-app/lib/queries/search.ts
  280:27  warning  '_titleMatches' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/invite-member-pagination.test.ts
  186:22  warning  '_columns' is defined but never used  @typescript-eslint/no-unused-vars

✖ 2 problems (0 errors, 2 warnings)
```
(Both known pre-existing. Three additional warnings observed during the run came from this
validator's own temporary probe scripts in the repo root; those files were deleted and the
working tree is unchanged.)

### `npx vitest run --dir tests/unit`
```
 Test Files  1 failed | 128 passed (129)
      Tests  2 failed | 993 passed (995)
   Duration  23.98s
```
Sole failing file: `tests/unit/trash-list.test.tsx` — the known pre-existing M14 failure.

### Targeted integration runs (each file run alone, to avoid the known Supabase auth rate limit)
```
tests/integration/f326-rls-hardening.test.ts + f325-status-rename-sync.test.ts   10 passed (10)
f219-status-management                                  Tests  13 passed (13)
f220-status-delete-reassign                             Tests   7 passed (7)
f221-board-custom-columns                               Tests   7 passed (7)
f222-status-category-semantics                          Tests   8 passed (8)
f223-status-integration-list-search-dashboard           Tests   7 passed (7)
rls-saved-views                                         Tests  14 passed (14)
f229-saved-views-ui                                     Tests   8 passed (8)
f232-calendar-query                                     Tests   7 passed (7)
f235-calendar-filters                                   Tests   7 passed (7)
```

### Live adversarial probe against `qcipqonnqajmazdbysow` (this validator's own script, since deleted)
```
== seeded columns ==
  todo #64748b not_started
  in_progress #3b82f6 in_progress
  in_review #d97706 in_progress
  done #16a34a done

== AS-414 direct PostgREST as VIEWER ==
 insert: BLOCKED (42501)
 update: rows affected=0
 delete: rows affected=0
 DB state after viewer attempts: todo,in_progress,in_review,done

== project LEAD (workspace role=member) direct PostgREST ==
 insert: BLOCKED (42501 new row violates row-level security policy for table "project_statuses")
 reorder update: rows=0

== saved_views direct PostgREST as VIEWER ==
 insert scope=shared,is_default=true: ALLOWED
  -> visible to workspace OWNER (a different user): YES
 AS-434 cross-tenant PATCH: BLOCKED (42501)
  DB state: UNCHANGED (good)

== F325 rename trigger ==
 t1: status="todo" status_id_is_todo=true
 rename -> ok "Shipped h0hbtx"
   t1 after: status="Shipped h0hbtx" status_id_ok=true updated_at_changed=true
   t2 (soft-deleted) after: status="Shipped h0hbtx" status_id_ok=true
   activity delta: task_activity:0 notifications:0 audit_log:0
 rename to existing sibling name: BLOCKED 23505
 force status_id=null: stayed null (no spurious re-derivation)

== saved_views legitimate writes still work ==
 legit rename by owner (direct RLS): ok rows=1
 legit config change: ok rows=1

== private project ==
 private project cols seeded: 4
 workspace OWNER (non project member) direct rename on PRIVATE project: rows=1
```
