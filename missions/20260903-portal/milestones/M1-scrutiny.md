# M1 — Scrutiny report (adversarial)

Mission: 20260903-portal · Milestone M1 (Shell, phases, pages)
Commits reviewed: b47e17e (F001), 0a79860 (F002), 7c09f80 (F002b), 3533d19 (F003),
4a344b5 (F003b), a0c344d (F004), 54c1e80 (F005), aee35c0 (F005b), 7e2fc79 (F006)
Method: 6 independent parallel reviewers (code + assertions only, no handoffs), plus
direct review by the validator. Full vitest suite deliberately NOT run (per instruction);
`npx tsc --noEmit` and `npm run lint` were run in full — output at the bottom.

**Verdict: M1 does not pass.** 6 blockers, 11 majors.

---

## Assertion table

| ID | Verdict | Reason |
|---|---|---|
| AS-001 | PASS | Sidebar renders all eight views in order with `aria-current`; persistent per project route. Caveat: absent on the `/portal/<slug>` chooser landing page, and below `md` it is a top strip, not a left sidebar. |
| AS-002 | FAIL (major) | Count is real (`tasks.pending_client_approval`), but the tile and the list beneath it are computed from two different scopes and two different predicates — they visibly disagree. Also returns a real-looking `0` on query error. |
| AS-003 | FAIL (blocker) | `deliverablesPastDue: 0` is a hard-coded literal (`lib/queries/portal.ts:446`). No deliverables table, no query, no due-date comparison. Unimplemented, not passing. |
| AS-004 | FAIL (major) | Navigation is genuine `next/link` with real URLs and working back button, but the topbar prints "Overview" as the view title on `/files`, `/requests` and `/t/[taskId]`, and the sidebar marks no item current there. |
| AS-005 | PASS | `target_launch_date` / `launch_confidence` read from real columns; null renders `—` / "not set yet", never a fabricated date or default confidence. Covered by a live-Supabase integration test. |
| AS-006 | PASS | All 22 files under `app/(portal)/` sit under one layout whose guard chain is unconditional and server-side. No `route.ts` under the portal path, no `middleware.ts`. `canViewClientPortal` = `isClient`, so every other role is redirected to `/w/<slug>`. |
| AS-007 | FAIL (blocker) | `getPortalProjectOptions` and `getPortalRequests` return rows of `portal_enabled = false` projects, live on the Requests route. See B1. |
| AS-008 | PASS (fragile) | Full column set with CHECK constraints and real integration coverage. Ordering is not guaranteed by the schema: no unique `(project_id, position)`, `position` defaults to 0, and the reorder path can leave duplicates. |
| AS-009 | FAIL (blocker) | Not implemented and not assigned to any M1 feature. `create_project_from_template` contains no reference to phases; grep for "phase" in the template RPC and in `lib/actions/templates.ts` returns nothing. |
| AS-010 | PASS | `phase-timeline.tsx` derives every row from its own `state`; no single-active selection anywhere. Zero/one/dateless phases handled without NaN. See M5 for the date-fabrication defect that sits alongside it. |
| AS-011 | FAIL (major) | The `client_visible` filter is right, but the figure is fabricated on a failed statuses read (every task falls to `not_started`, every phase reports 0% while the total stays correct), and the only test mocks a chain that ignores its own filter arguments. |
| AS-012 | FAIL (blocker) | The phase-row half is enforced twice over and well tested. But `getPortalLiveNow` leaks the *name* of a `client_visible = false` phase to the client. See B2. |
| AS-013 | FAIL (blocker) | The assignment does not survive a reload. See B3. |
| AS-014 | FAIL (blocker) | The team cannot define page order for the workspaces F005b claims to have fixed, and existing non-English workspaces have a permanently empty, unfixable Pages view. See B4 and B5. |
| AS-015 | PASS (mechanism) / FAIL (surroundings) — **FAIL** | `resolveClientBucket` is correctly single-sourced and the pill shows the team's own `project_statuses.name`. But `clientStatusLabel` is a live name-regex second mapping in the same module; the bucket→label map is triplicated with one copy already diverged; a null-`status_id` page renders a coloured pill with an empty label. |
| AS-016 | INCONCLUSIVE | Plumbing is correct and genuinely tested end to end (DB → query → prop → tooltip), with no UI-side fallback string. But the only descriptions in existence are generic copy authored by the migration, and every pre-existing project has `client_description = null` with no backfill — so the assertion is either false on existing data or satisfied by text the agency never wrote. |
| AS-017 | FAIL (major) | Counts are structurally sound (one source, every bucket stated in text at zero, no unlabelled segment) but the "waiting on the client" count includes every not-started page. |
| AS-018 | PASS | Pure `useState` + `Array.filter` over the fetched prop, filtering on the same `clientBucket` the pill tints from. No network request. |
| AS-031 | FAIL (blocker) | `getPortalRisks` is `return []` unconditionally; `RiskBanner` therefore renders `null` on every real render. No overdue blocking deliverable is ever surfaced. |

---

## Blockers

### B1 — AS-007: two portal queries return rows of a portal-disabled project, and the client can write to it
`lib/queries/portal.ts:736-747` (`getPortalProjectOptions`) and `:684-702` (`getPortalRequests`) select from `projects` filtering only on `workspace_id` and `deleted_at`. F001 added `.eq("portal_enabled", true)` to `getPortalProjects` (`:113`) and only there — and that function's own comment states why it is load-bearing: *"RLS still lets a client read the `projects` row itself (portal_enabled has no bearing on ordinary project visibility), so this filter is the actual gate."*

Both are live at `app/(portal)/portal/[workspaceSlug]/p/[projectId]/requests/page.tsx:36-37`.

Trigger: a client holding `project_members` rows on Project A (`portal_enabled = true`) and Project B (`portal_enabled = false`) — exactly the fixture F003's own test seeds at `tests/integration/f003-portal-shell.test.ts:151-157`. Opening `/portal/<slug>/p/<A>/requests` renders `NewRequestForm` with **Project B's name** in the project `<select>`, and `RequestList` with every `client_requests` row the client filed against B.

It is also a write path: `client_requests_insert_own` (`20260902030000:109-120`) gates on `is_project_client AND is_project_visible_to` and was never folded, and `createClientRequest` adds no check — so the client can file a new request against the portal-disabled project from that dropdown.

No test covers AS-007's second clause on any query other than `getPortalProjects`.

Related, narrower: `project_statuses_select_visible` was explicitly left unchanged by F001 (`20260909010000:96-101`, "No RLS change needed here"), so `GET /rest/v1/project_statuses?project_id=eq.<B>` returns every board-column name plus the new `client_description` to the client of a portal-disabled project.

### B2 — AS-012: a `client_visible = false` phase's name is shown to the client
`lib/queries/portal.ts:552-553`:
```ts
admin.from("project_phases").select("id, name").in("id", phaseIds)
```
Service-role client, no `client_visible` filter, no `project_id` re-check. When a timer runs on a task with `client_visible = false`, `getPortalLiveNow` labels the entry with that task's phase name (`:570-573`) and `LiveNow` renders it verbatim in the overview's right rail.

Trigger: a `project_phases` row with `client_visible = false` named e.g. "Rebuild after client rejected v1"; any team member starts a timer on an internal task in that phase; the client's overview shows `Alice — Rebuild after client rejected v1`.

`getProjectPhases` (`:275`) applies `.eq("client_visible", true)`. This second, admin-client path does not. The unit test at `tests/unit/portal-overview-queries.test.ts:193-216` bakes the defect in: its fixture phase has no `client_visible` field at all and the test asserts the name **is** shown.

### B3 — AS-013: the phase assignment does not survive a reload
`lib/actions/tasks.ts` contains **zero** occurrences of `phase_id` or `phaseId` (verified by grep). `getTaskDetail`'s select (`:2787`) lists `page_slug, page_order, task_types(name), …` but not `phase_id`, and the returned object (`:3195-3260`) has no `phaseId` key. `getTaskDetail` is the sole producer of `TaskDetailSheetTask`.

`components/task/task-detail-sheet.tsx:401` declares `phaseId?: string | null`; `:1195` and `:1740` read `task.phaseId ?? null` as the Select's base value. It is therefore always `undefined`.

Worse than a reload: `:1200` and `:806` reset `confirmedPhaseId` to `undefined` on every task re-sync, so **closing and reopening the same task** shows "No phase". The DB row is correct; the UI is not.

The test that claims to cover this is `tests/unit/f002-task-detail-sheet-phase-optimistic.test.tsx:236-269`, named `test_AS_013_assigning_a_task_to_a_phase_survives_being_re-synced_from_a_reload`. It mocks `getTaskDetail` to return `phaseId: "phase-2"` (`:257`) — a field the real function never returns. It asserts the component renders a value production can never supply. This is the archetype of a test that mirrors an imagined implementation rather than the assertion's intent.

F005 added `page_slug`/`page_order` to that exact select and object for its own assertion — the pattern was known and not followed.

### B4 — AS-014: F005b fixed only half the seam; the write side is still on the old name match
`components/task/task-detail-sheet.tsx:1959`:
```tsx
{task.taskTypeName?.trim().toLowerCase() === "page" && (
```
fed by `lib/actions/tasks.ts:2787` and `:3249-3253`.

F005b changed only the read side (`getPortalPages` → `system_key`). The task detail sheet is the **only** UI that writes `page_slug` / `page_order`, and it still gates on the human-editable type *name*.

Trigger: a workspace whose page type is tagged `system_key = 'page'` but named "Sida" — exactly the case F005b's own commit message and migration header say it fixes, and exactly what `test_AS_014_primary_success_renaming_the_page_type_leaves_the_pages_view_returning_the_same_rows` exercises. The portal lists the rows; the team can no longer see the Page order field on any of them. "Ordered by the page order defined by the team" becomes unreachable through the product for precisely the workspaces F005b claims to have fixed.

Converse trigger: rename an unrelated type to "Page" (permitted — the unique index is on name, and the real page type is now "Sida"): the sheet shows Page slug/order on tasks the Pages view will never list.

The stale rationale survives as a comment at `:1950-1957`, and `tests/unit/f005-task-detail-sheet-page-fields.test.tsx:176` actively certifies the name-based gate. F005b touched neither.

### B5 — AS-014: `system_key` cannot be set from the application; the backfill strands existing workspaces
`supabase/migrations/20260912010000_task_type_system_key.sql:39-42` backfills `where system_key is null and name ilike 'page'` — an exact case-insensitive match, no wildcard. Types named "Pages", "Page " (trailing space passes the non-blank check), "Sida", "Stranica" get nothing. The seed in `create_workspace_with_owner` only helps workspaces created *after* the migration.

There is no write path for the column anywhere: grep across `app/`, `components/`, `lib/` finds `system_key` only in the migration, `lib/queries/task-types.ts` (read), `database.types.ts`, and `components/workspace/task-type-manager.tsx:106-118` (a read-only "Portal" badge). `lib/validation/task-types.ts` has no `systemKey` field; `lib/actions/task-types.ts` never writes it.

Consequence: an existing workspace with a "Sida" page type has a permanently empty Pages view rendering *"No pages have been shared with you yet."* — a client-facing statement of fact that is false, produced by a configuration fault, with no admin-fixable control. Only a manual SQL `UPDATE` recovers it. `tests/integration/f005b-task-type-system-key.test.ts:199` enshrines this as intended.

### B6 — AS-031 is unimplemented and its test asserts JSX, not behaviour
`lib/queries/portal.ts:467-469` — `getPortalRisks` is `return []` unconditionally. `components/portal/risk-banner.tsx:17-19` returns `null` when `risks` is empty. No blocking overdue deliverable is ever surfaced anywhere on the overview.

`components/portal/risk-banner.test.tsx:24-37` hand-constructs `risks=[{message: "Content for the Services page is 6 days late…"}]` and asserts the component renders the string it was handed. The commit message claims AS-031.

The same applies to AS-003: `deliverablesPastDue: 0` at `:446` is a literal, and `tests/unit/portal-overview-queries.test.ts:142-150` asserts `toBe(0)` against a mock where the task count is 5 — an unfalsifiable assertion of a constant.

---

## Majors

### M1 — `bulkSetTaskPhase` drops the private-project visibility gate its own stated model enforces
`lib/actions/phases.ts:715-821`. The row query at `:742` selects `projects!inner(id, workspace_id, visibility)`, but `TaskRow` (`:746-749`) and `Context` (`:752`) both omit `visibility` and it is never consulted. The loop at `:786-804` checks membership + `canEditTask` + phase↔project match, then writes through the service-role client.

Its cited precedent, `bulkUpdateTasks` (`lib/actions/tasks.ts:3994-4039`), does the check that is missing:
```ts
if (context.visibility === "private" && role !== "owner" && role !== "admin"
    && !explicitMemberProjectIds.has(context.projectId)) { failedIds.push(...); continue; }
```
Trigger: a workspace `member` who is not in `project_members` for a private project invokes the Server Action directly with a task id from that project. `setTaskPhase` rejects the identical call via `requireVisibility`; the bulk sibling accepts it and the admin client bypasses RLS.

Every other action in `lib/actions/phases.ts` was verified: `withAuthz` runs and is awaited in full before `ctx.admin` is touched, and each resolves the workspace/project from the resource id rather than trusting input. `setTaskPhase` additionally validates the phase belongs to the task's project (`:646-660`). Only the bulk path is broken.

### M2 — `seed_default_phases` uses a deny-list where its cited precedent uses an allow-list; viewers can write
`supabase/migrations/20260909010000_portal_foundations.sql:265-268`:
```sql
if v_caller_role is null or v_caller_role = 'client' then
```
The comment at `:238` claims the "same shape `apply_status_template` uses". That function's guard (`20260903010000:193`) is `not in ('owner','admin')` — an allow-list. The workspace role domain is `owner|admin|member|viewer|guest`, so a **viewer** can insert ten `project_phases` rows, which the table's own `project_phases_insert_team` policy (`is_project_workspace_writer` = `role not in ('viewer','client')`) explicitly forbids. `grant execute … to authenticated` (`:294`) makes it callable directly at `POST /rest/v1/rpc/seed_default_phases`; the `withAuthz` wrapper in `lib/actions/phases.ts:526` does not protect the RPC boundary.

### M3 — `project_phases` write policies omit the visibility conjunct its sibling table carries
`20260909010000:163-183`: insert/update/delete all use `is_project_workspace_writer(project_id)` alone. `project_statuses_insert_admin` (`20260828040000:76-83`) uses `is_project_visible_to(project_id) AND is_project_workspace_admin(project_id)`. `is_project_workspace_writer` checks workspace membership and role only, never project visibility. A workspace `member` not in `project_members` of a `visibility = 'private'` project can insert, update (`state`, `client_visible`, dates) and delete that project's phases despite not being able to SELECT one. `seed_default_phases` never calls `is_project_visible_to` at all.

### M4 — `create_channel_atomic` re-created without `pg_temp`, violating design constraint 5
`supabase/migrations/20260910010000_create_channel_atomic_nullable_args.sql:45` — `set search_path = public`, on a SECURITY DEFINER function granted EXECUTE to `authenticated`. F002b **drops and re-creates** this function (`:32-63`), the one moment where the fix costs nothing, and carries the unqualified form forward.

Postgres searches `pg_temp` first for relation names when it is not explicitly listed, and `authenticated` has TEMP privileges by default, so a caller can shadow `channels` / `channel_members` inside the body. This is the exact class `20260908010000` was written to close, and F001, F004 and F005b all pin correctly — this is the one miss.

Note this migration was outside the three listed in the review brief; it is in scope because commit 7c09f80 is in M1.

### M5 — Dateless phases are drawn at invented positions on a real date axis
`components/portal/phase-timeline.tsx:163-185`. When at least one phase has planned dates, the axis carries real week labels and a "Today" rule. A phase missing either date is then given `xPx = datelessIndex * (chartWidthPx / datelessCount)` and a bar of that width — so a phase with **no dates at all** renders as a bar under, say, "1 Jun … 15 Jun" and reads as a scheduled window. With one dated and one dateless phase, the dateless bar spans the entire chart. Nothing distinguishes it: `fallback` is exposed only as a `data-fallback` test attribute (`:351`), never as a label or hatch.

`MIN_BAR_WIDTH_PX = 24` (= 4 days at 6 px/day) compounds it: a genuine 1-day phase is drawn 4 days wide, and a phase with `planned_end < planned_start` renders as a 4-day bar rather than flagging bad data.

Under "no client-facing figure that is not real", these are fabricated dates.

### M6 — Files and Requests are unreachable from any navigation (regression)
`components/portal/portal-nav.tsx` (deleted in 3533d19) was the only thing linking Files and Requests (`3533d19^:components/portal/portal-nav.tsx:25-26`). The replacement sidebar's eight items contain neither, and a repo-wide grep for `/portal/` finds no href producing `…/p/<id>/files` or `…/p/<id>/requests`. The legacy stubs at the old paths are equally unlinked, so the "stale bookmark" story F003b's comments rely on is the only remaining entry point.

The client request inbox is the client's only *write* path in the entire portal. This is a regression, not an unbuilt feature: both views were reachable before 3533d19.

### M7 — The topbar mislabels the current view on three of eleven project routes
`components/portal/portal-topbar.tsx:64-67`. `buildPortalNavItems` knows only the eight views; `files`, `requests` and `t/[taskId]` match neither branch, so the lookup falls through to `items[0]` = Overview. Verified empirically: all three render `<h1>Overview</h1>` while the page body renders its own, different `<h1>`. `portal-topbar.test.tsx:52-61` exercises only `/results` and the index.

### M8 — AS-017's "waiting on the client" count includes every not-started page
`components/portal/status-label.ts:44-48` maps `not_started → "waiting"`, and `components/portal/status-distribution.tsx:28` labels that bucket **"Waiting on you"**. Any page in a `not_started` status with no explicit `client_bucket` is reported to the client as waiting on them.

Concrete row: the F005 integration fixture's own page in status "Backlog" (`tests/integration/f005-portal-pages.test.ts:202-207`), which `:429` asserts lands in `waiting`. A page nobody has started is reported as blocked on the client.

This contradicts the portal's other use of the same phrase: `overview-tiles.tsx:80` labels a tile "Waiting on you" driven by `pending_client_approval`, whose own comment says inferring "waiting on you" from status was the bug it fixed. `page-travel-strip.tsx:8` states "Waiting on you (step 2) is the one step where the ball is in the CLIENT's court". A Backlog page therefore appears in the Pages distribution's "Waiting on you" count while appearing nowhere in the Overview's "Waiting on you" list.

### M9 — AS-002's two surfaces disagree, and a failed count renders as a real zero
Two independent problems on the same number:
1. **Scope and predicate divergence.** `page.tsx:111` feeds `badges.approvalsAwaiting` (project-scoped, no `category !== 'done'` filter) into the tile, while `PortalOverviewLive` immediately below is fed `getPortalOverview(workspace.id)` — workspace-wide and excluding `category === "done"` (`portal.ts:946`). A client on two projects sees "2" in the tile and five rows in the list; a pending task moved to a Done column counts in the tile and not in the list.
2. **Fabricated zero.** `portal.ts:439-445` returns `count ?? 0` after logging the error. `overview-tiles.tsx:81-88` then renders `0` with the footnote **"Nothing waiting on you"**. A dropped connection tells the client they have nothing to review. Every other tile honours the em-dash rule; this one does not. `tests/unit/portal-overview-queries.test.ts:152-158` enshrines it.

### M10 — `reorderPhases` is a non-atomic two-row swap that can corrupt ordering
`lib/actions/phases.ts:481-496`: read siblings, then two independent `UPDATE`s in `Promise.all` — no transaction, no RPC, and no unique `(project_id, position)` constraint (deliberately absent, `20260909010000:55-58`).
- **Partial failure:** one update succeeds, the other errors → returns `GENERIC_ERROR` but leaves two phases sharing a position, with no compensating write.
- **Concurrency:** A=1, B=2, C=3; two users move B up and C up from the same snapshot → A=2, B=3, C=2. Duplicate position, and the phase moved *up* ends up last.
- `createPhase` (`:196-207`) computes `max(position)+1` in a read-then-write with the same race.

`getProjectPhases` orders on `position` alone (`portal.ts:276`), so duplicates render in arbitrary, load-to-load order — AS-008's "ordered list" is not guaranteed by the schema.

### M11 — Errors rendered as honest-looking empty data across `lib/queries/portal.ts`
| Line | Behaviour |
|---|---|
| `117-118` | `getPortalProjects` returns `[]` on error → the project layout calls `notFound()`; a transient DB error is indistinguishable from "portal disabled" |
| `139-142`, `155`, `215` | tasks/statuses errors logged then `?? []` → a project renders as 0 tasks with an empty progress bar |
| `302-317` | `getProjectPhases` — a failed `project_statuses` read makes every task fall to `not_started`, so a fully delivered phase reports **0% complete** with a correct-looking denominator (AS-011) |
| `1118`, `1129`, `1141` | `getPortalFiles` never destructures `error` on any of its three queries → renders "No files yet" on failure |
| `740-746` | `getPortalProjectOptions` never checks `error` |
| `802`, `812`, `828` | `getPortalTaskDetail` never checks `error` → a failed comment read renders an empty conversation, i.e. "the team said nothing" |

---

## Minors

- **`is_project_portal_enabled` is executable by PUBLIC/anon.** `20260909010000:113-124` issues no `revoke all … from public`, unlike `seed_default_phases` in the same file (`:293`). Verified: grep for a revoke/grant on this function across all migrations returns nothing. `POST /rest/v1/rpc/is_project_portal_enabled` with the anon key returns any project's `portal_enabled`, bypassing `projects` RLS. UUIDs are unguessable, so practical severity is low.
- **`progressPercent` contradicts `state`.** `portal.ts:345` returns `0` for a phase with zero client-visible tasks; `phase-timeline.tsx:275` renders `{STATE_LABEL} · {progressPercent}%` unconditionally. A phase marked `done` whose tasks are all internal renders **"Done · 0%"** with an empty bar. The sibling `PortalProject.percentComplete` (`:212`) returns `null` in exactly this case for the stated reason that 0% "would read as 'no work has been done'". The field's own doc comment (`:241-246`) opens by promising null and reverses itself three lines later.
- **`getPortalLiveNow` / `getPortalTeam` are not independently correct.** `portal.ts:513, 607` use `createAdminClient()` with a raw `projectId`, contradicting the file's own header invariant (`:4-7`). Neither checks `portal_enabled`, `deleted_at`, or caller membership; both re-derive RLS in TypeScript and drop the `status = 'active'` conjunct (`:564`, `:641` filter only `role !== "client"`, and an absent `workspace_members` row yields `undefined`, which passes). Safe today only because `page.tsx:80-83` gates first.
- **Task detail never verifies the task belongs to the URL's project.** `p/[projectId]/t/[taskId]/page.tsx:29` destructures `projectId` and never reads it. `/p/<A>/t/<taskInB>` returns 200 with Project A's chrome around Project B's task. Not a leak (RLS holds), but it breaks the "independently correct" convention every sibling route documents about itself.
- **`getPortalActivitySummary` writes during render.** `portal.ts:1083-1088` updates `portal_last_seen_at` as a side effect of rendering a Server Component. Any RSC prefetch or double-invocation silently consumes the client's "since your last visit". Both the chooser page and the project page call it.
- **Cross-project bleed on a project-scoped overview.** `page.tsx:94` and `:100` pass `workspace.id` to `getPortalOverview` / `getPortalActivitySummary`. "Since your last visit" (`:143-197`) renders other projects' tasks with **no project label at all** and links out of the current project.
- **Bucket→label map triplicated.** `pages-table.tsx:39-44`, `status-distribution.tsx:27-32`, `status-manager.tsx:81-87`. The first two are byte-identical; the third already disagrees ("Waiting on client"/"Done" vs "Waiting on you"/"Ready to launch").
- **`clientStatusLabel` (`status-label.ts:8-16`) resolves a client-facing phrase by `/review/i` on the status name** — the exact anti-pattern the adjacent `resolveClientBucket` comment forbids. Consumed at `components/portal/task-list.tsx:304`. Currently dead code after the F003b route move, but shipped and un-deleted, in the module F004 designated as the single home for this concept.
- **Null `status_id` renders a colour-only pill.** `portal.ts:1319` / `:1344` default to `category "not_started"` and `name ""`. `tasks.status_id` is nullable and `sync_task_status_and_status_id` (`20260824010000:214-222`) sets it to NULL when the text status matches no column name. Result: an amber dot with an empty label — meaning carried by colour alone, against design constraint 4.
- **Seeded task-type colour is off-palette.** `20260912010000:89` seeds `'#3670e1'`, which is `--status-progress` copied into SQL and is not in `COLUMN_COLOR_PALETTE`. `isApprovedColumnColor` returns false, so `updateTaskType` would refuse to write it, and the colour `<Select value={taskType.color}>` in the task-type manager has no matching item for it on every new workspace.
- **`page-travel-strip.tsx` shows a seven-step pipeline no project's data has.** `seed_default_project_statuses` gives four columns (todo/in_progress/in_review/done). The strip is plan-sanctioned prototype copy ("copy from the prototype", plan.md F005), so this is a plan/implementation mismatch rather than a worker defect — but it is client-facing text asserting a process the data does not model.
- **AS-016 has no backfill.** Every status on every pre-existing project has `client_description = null`, so the tooltip does not exist at all on existing data.
- **UTC "today".** `page.tsx:39-41` and `portal.ts:90-92` use `new Date().toISOString().slice(0,10)`. `planned_start`/`planned_end`/`due_date` are `date` columns; "Days to launch", the Today rule, and `due_date < today` are all off by one for a client far from UTC.
- **`tasks.phase_id` has no same-project constraint.** `20260909010000:72` — no CHECK, no trigger. `getProjectPhases`'s task query filters on `phase_id` with no `project_id` filter, so a cross-project write would be counted into the wrong project's progress. Nothing in the schema prevents it (the application layer does).
- **Duplicated "Hours used" card.** `overview-tiles.tsx:101-106` and `page.tsx:203-212` both render the same label, `—`, and footnote; the rail version re-types `Tile`'s markup verbatim instead of importing the primitive.
- **`formatUpdatedAt` is a third byte-identical copy** of the date formatter in `file-list.tsx:17-23` and `request-list.tsx:44-50`.

---

## Design-constraint compliance

| Constraint | Result |
|---|---|
| 1. Tokens only, no hex in components | **PASS.** `app/globals.css:103-106` and `:161-164` match the plan's eight values exactly. Repo-wide grep finds hex only in `globals.css` and in pre-existing files untouched by M1 (`lib/task-colors.ts`, `lib/user-color.ts`, `lib/board/column-colors.ts`, `components/board/board-column.tsx`, `lib/queries/dashboard.ts`). No hex in any M1 component diff, including `phase-timeline.tsx`'s inline SVG (all fills/strokes are `fill-status-*` / `stroke-border` classes). One hex reached a migration (`20260912010000:89`) — see Minors. |
| 2. Reuse before building | **PARTIAL.** Correct reuse of `EmptyState`, `UserAvatar`, `WorkspaceLogo`, `ThemeToggle`, `Badge`, shadcn `Tooltip`/`Select`/`Table`. `portal-sign-out-button.tsx` wraps the real `Button`. Violations: the duplicated Hours card, the triplicated bucket→label map, the third date formatter. |
| 3. Status semantics added once | **PARTIAL.** `resolveClientBucket` is genuinely single-sourced; `clientStatusLabel`'s name regex survives beside it. |
| 4. State never colour alone | **PARTIAL.** Timeline, distribution and pills all carry text — except a null-`status_id` page's pill, which is an amber dot with an empty label. |
| 5. RLS pattern + `pg_temp` | **PARTIAL.** F001, F004, F005b all pin `public, pg_temp` correctly and byte-identically to `20260908010000`. F002b's `create_channel_atomic` does not (M4). Write policies deviate from the sibling-table pattern (M3). |
| 6. Multi-table writes via RPC | **PARTIAL.** F001/F004 add no multi-table write. `reorderPhases` is a multi-row, two-round-trip write with no RPC and no transaction (M10). |
| 7. Server fetches, client receives props | **PASS.** No client component queries Supabase. `PortalSidebar`/`PortalTopbar`/`PhaseTimeline`/`PagesTable` are `"use client"` only for `usePathname`/`useState`. The one client-side Supabase touch is the pre-existing F008 realtime subscription. |

---

## Recommended follow-up features

**FU-1 (blocker, AS-007) — Fold `portal_enabled` into every remaining portal read and the client-request write.**
Add `.eq("portal_enabled", true)` to `getPortalProjectOptions` and `getPortalRequests`, and audit every other `from("projects")` in `lib/queries/portal.ts` for the same omission. Extend `client_requests_insert_own` and `createClientRequest` so a client cannot file against a portal-disabled project. Consider folding `portal_enabled` into the client branch of the `projects` and `project_statuses` select policies so the database, not the query builder, is the gate — the migration's own decision to leave `projects` RLS alone is what makes every one of these queries a separate place to remember. Tests must extend the existing two-project fixture (`f003-portal-shell.test.ts:151-157`) to assert, per query function, that the disabled project's id and name are absent, and that an insert against it is rejected.

**FU-2 (blocker, AS-012) — Stop `getPortalLiveNow` leaking hidden phase names.**
Add `.eq("client_visible", true)` to the `project_phases` lookup at `lib/queries/portal.ts:552`, and fall through to the generic "Working on the project" label when the phase is hidden. While there, make `getPortalLiveNow` and `getPortalTeam` independently correct rather than caller-gated: check `portal_enabled`, `deleted_at`, and the caller's membership inside each function, and restore the `status = 'active'` conjunct dropped from the workspace-members role lookups. Test with a hidden phase, an inactive workspace member, and a project member with no workspace-members row.

**FU-3 (blocker, AS-013) — Plumb `phase_id` through `getTaskDetail`.**
Add `phase_id` to the select at `lib/actions/tasks.ts:2787` and `phaseId: taskRow.phase_id` to the returned task object, mirroring what F005 did for `page_slug`/`page_order`. Rewrite `tests/unit/f002-task-detail-sheet-phase-optimistic.test.tsx:236-269` so it derives its fixture from the real `getTaskDetail` return type rather than hand-supplying a field that does not exist, or move that case to the integration suite where it reads the real row back. The general lesson is worth encoding: any unit test that mocks a server action's return value should be constructed from that action's exported type, so a missing field is a type error rather than a green test.

**FU-4 (blocker, AS-014) — Close the `system_key` seam on the write side and give it a control.**
Change the task detail sheet's page-fields gate from `taskTypeName === "page"` to the task type's `system_key`, which means adding `task_types(system_key)` to `getTaskDetail`'s select and a `taskTypeSystemKey` field to `TaskDetailSheetTask`. Then add a real write path: a "portal role" select in the task-type manager backed by a Zod-validated server action, so a workspace whose type is named "Sida" can tag it without SQL. Broaden the migration's backfill or, better, make the empty Pages view state distinguish "no page type is tagged in this workspace" (a team-fixable configuration message on the team side) from "no pages have been shared yet" — the client should never be told the second when the truth is the first.

**FU-5 (major, authorization) — Restore the private-project gate on `bulkSetTaskPhase`.**
Port the `visibility === "private"` branch from `bulkUpdateTasks` (`lib/actions/tasks.ts:3994-4039`) into `lib/actions/phases.ts:786-804`, including the batched `project_members` lookup. Better: extract the whole context-loading + authorization loop that both functions now duplicate into one shared helper (`loadBulkTaskAuthContexts` already exists at `tasks.ts:3877` and was re-implemented rather than reused), so the next bulk action inherits the gate instead of re-deriving it. Add a test with a workspace member who is not a project member of a private project and assert the task id lands in `failedIds` and the row is unchanged.

**FU-6 (major, database) — Harden the F001/F002b SQL surface.**
Four changes in one migration: (a) change `seed_default_phases`'s role guard from the `= 'client'` deny-list to an allow-list matching `is_project_workspace_writer`, and add an `is_project_visible_to` check; (b) add `is_project_visible_to(project_id)` to the three `project_phases` write policies, matching `project_statuses_insert_admin`; (c) add `revoke all on function public.is_project_portal_enabled(uuid) from public; grant execute … to authenticated;`; (d) re-create `create_channel_atomic` with `set search_path = public, pg_temp`. Add a test that calls `seed_default_phases` as a viewer over PostgREST and asserts a 42501 and zero inserted rows.

**FU-7 (major, integrity) — Make phase reordering atomic.**
Replace the two-update swap in `reorderPhases` with a single SECURITY DEFINER RPC (`swap_phase_positions(project_id, phase_id, direction)`) that reads and writes inside one transaction, pinning `public, pg_temp`, following `accept_client_request_atomic`. Add a unique `(project_id, position)` index with deferred checking, or have the RPC renumber the whole project's positions densely on every move so duplicates cannot persist. Give `getProjectPhases` a deterministic tiebreak (`.order("position").order("name")`). Reconcile the optimistic client state in `phase-list.tsx:410-429` when the server returns `swappedWith: null`.

**FU-8 (major, honesty) — Remove every fabricated client-facing figure from the overview and the timeline.**
Three changes: (a) `getPortalBadgeCounts` should return `null`, not `0`, on a failed count, and `OverviewTiles` should render `—` for null, matching what the Hours tile already does; (b) make the tile and the "waiting on you" list read from one query at one scope, so they cannot disagree, and give the tile the same `category !== 'done'` predicate the list uses; (c) in `phase-timeline.tsx`, render dateless phases distinguishably — a hatched or outlined bar with an explicit "no dates set" label — rather than placing them at invented coordinates on a real week axis, and treat `planned_end < planned_start` as bad data rather than drawing a minimum-width bar. Also make `progressPercent` nullable so a phase with nothing shared reads "no shared work yet" instead of "Done · 0%".

**FU-9 (major, navigation) — Restore Files and Requests to the shell, and label every route.**
Add the two views back to the portal navigation (as a secondary group beneath the eight, if AS-001's list must stay exact), and scope both queries to the project whose shell wraps them rather than the whole workspace. Extend `buildPortalNavItems` — or add a separate title map consulted by `PortalTopbar` — so `files`, `requests` and `t/[taskId]` get their own view title instead of falling through to "Overview". Have `p/[projectId]/t/[taskId]/page.tsx` verify the task's `projectId` matches the URL segment, as its sibling routes already do for the project.

**FU-10 (major, AS-017) — Give "waiting on the client" a real definition.**
`not_started → waiting` conflates "nobody has started this" with "the client is holding this up". Either introduce a fifth bucket for not-started work with its own label ("Not started"), or make `not_started` fall back to a neutral bucket and require an explicit `client_bucket = 'waiting'` for anything to be reported as waiting on the client. Whichever is chosen, the distribution key, the filter dropdown, the overview tile and `page-travel-strip` must all use one label source — extract the bucket→label map to a single exported constant and delete the three copies. Fix `status-distribution.test.tsx` to assert label/count *pairing* (currently swapping two labels leaves every test green) and add a case for a page whose `status_id` is null.

**FU-11 (major, AS-011) — Make the phase progress figure fail loudly.**
`getProjectPhases` currently logs a failed `project_statuses` or `tasks` read and then computes a confident-looking figure from empty maps. Return a distinguishable "unavailable" state and have the timeline render it as such. Replace `tests/unit/portal-phases-query.test.ts` with an integration test that inserts a `client_visible = false` task into a real phase and asserts the progress number — the present mock ignores every filter argument, so changing `.eq("client_visible", true)` to `false` leaves all four tests green.

**FU-12 (blocker, AS-009) — Seed template phases in the project-creation transaction.**
`create_project_from_template` (`20260822190000`) has no phase handling and no M1 feature was assigned to AS-009. Add a `project_phases` templates table (or reuse the existing template payload shape) and insert the phases inside the same RPC transaction that creates the project, following `seed_default_project_statuses`' relationship to project creation. Test that a project created from a template with N phases has exactly N ordered rows, and that a failure partway leaves neither project nor phases.

**FU-13 (minor, AS-016) — Decide what a status explanation is, then backfill or surface its absence.**
The four descriptions seeded by `20260911010000:63-66` are generic copy authored by the migration, presented to the client identically to text a PM wrote; every pre-existing project has none. Either commit to seeded defaults and backfill them onto existing projects (so the assertion holds everywhere), or drop them and surface the absence to the team — a "no client explanation set" hint in the board-columns settings screen — so the gap is visible to the people who can close it. Add a test for the null-description branch rendered through `PagesTable`, and one asserting no hard-coded fallback string can creep into `StatusPill`.

**FU-14 (minor, resilience) — Stop rendering query failures as empty data.**
Sweep `lib/queries/portal.ts` for the pattern in M11: bind `error` on every destructure, and give each function a way to say "unavailable" that its caller renders as such rather than as "nothing yet". Move `getPortalActivitySummary`'s `portal_last_seen_at` write out of the render path into a Server Action or a route handler so a prefetch cannot consume the client's "since your last visit".

---

## Tooling output

### `npx tsc --noEmit`
Clean — no output, exit 0.

### `npm run lint`
```
> pm-app@0.1.0 lint
> eslint

/Users/sasajapranin/Desktop/pm-app/components/chat/message-list.tsx
   22:26  warning  'SmilePlus' is defined but never used                        @typescript-eslint/no-unused-vars
  161:5   warning  Unused eslint-disable directive (no problems were reported from 'react-hooks/exhaustive-deps')

/Users/sasajapranin/Desktop/pm-app/lib/queries/portal.ts
  467:38  warning  '_projectId' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/missions/20260830-223927/milestones/M2-evidence-2/probe.mjs
  23:7  warning  'status' is assigned a value but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/missions/20260830-223927/milestones/M2-evidence/probe.mjs
  23:7  warning  'status' is assigned a value but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/f002-task-detail-sheet-phase-optimistic.test.tsx
  98:4   warning  '_taskId' is defined but never used   @typescript-eslint/no-unused-vars
  98:21  warning  '_phaseId' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx
  98:4   warning  '_taskId' is defined but never used  @typescript-eslint/no-unused-vars
  98:21  warning  '_status' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx
  104:4   warning  '_taskId' is defined but never used   @typescript-eslint/no-unused-vars
  104:21  warning  '_updates' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/f005-task-detail-sheet-page-fields.test.tsx
  64:31  warning  '_taskId' is defined but never used   @typescript-eslint/no-unused-vars
  64:48  warning  '_updates' is defined but never used  @typescript-eslint/no-unused-vars

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

✖ 20 problems (0 errors, 20 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```
0 errors. The `lib/queries/portal.ts:467` warning is the `getPortalRisks` stub parameter — a lint-visible marker of the AS-031 stub (B6).

### Test suite
Not run in full, per instruction (≈6 min, known pre-existing failures in unrelated files, a run already in flight, and a second concurrent run manufactures Supabase auth rate-limit failures). Reviewers ran targeted portal component/unit files: 31 tests in the six F006 files pass; 18 tests across the five F005/F005b component and unit files pass. The integration suites (`portal-phases-rls`, `f002-phase-management`, `f003-portal-shell`, `f003b-relocate-portal-routes`, `f005-portal-pages`, `f005b-task-type-system-key`) were read, not executed — they require live Supabase credentials. Test-quality findings are recorded per assertion above and are the basis for several FAIL verdicts that are independent of whether those suites currently pass.
