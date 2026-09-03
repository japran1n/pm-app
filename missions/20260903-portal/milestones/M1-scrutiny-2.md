# M1 — Scrutiny report #2 (post-remediation, adversarial)

Mission: 20260903-portal · Milestone M1 (Shell, phases, pages)
Remediation commits reviewed: 719a061 (F006b), f02c036 (F006d), 7f14441 (F006c), c616961 (F006e)
Baseline: `M1-scrutiny.md` (6 blockers, 11 majors) against 7e2fc79.

Method: four independent parallel reviewers, one per remediation feature, given the
assertion text and the changed-file list only — no handoffs, no commit messages, no
prior report. Plus direct verification by the validator of every one of the six
blockers against current `HEAD`. Full vitest suite deliberately not run (per
instruction); `npx tsc --noEmit` and `npm run lint` run in full; six targeted unit
files run (49 tests, all pass). Output at the bottom.

**Verdict: M1 does not pass.**

All six original blockers are genuinely closed or correctly reclassified — four fixed
in code, two (AS-003, AS-031) confirmed as planned sequencing rather than defects. But
the remediation introduced **one new blocker** — a migration that aborts the deploy on
a plausible data shape — and the **four assertions that were FAILING at major severity
in the first report (AS-002, AS-011, AS-015, AS-017) are byte-for-byte untouched**;
none of the four remediation features went near them. Six new majors were introduced
or exposed by the remediation itself.

---

## 1. Status of the six original blockers

| # | Assertion | Status | Evidence |
|---|---|---|---|
| B1 | AS-007 — portal-disabled project's rows returned by `getPortalProjectOptions` / `getPortalRequests`, and the client can write to it | **CLOSED** on the app surface; residue below | `lib/queries/portal.ts:715, 780` now carry `.eq("portal_enabled", true)`; `20260913010000` folds `is_project_portal_enabled` into the `client_requests` SELECT *author* branch and the INSERT `with check`. `tests/integration/f003-portal-shell.test.ts:165-222` proves it per-function on a two-project fixture with a positive control. |
| B2 | AS-012 — hidden phase's name leaked via Live-now | **CLOSED** | `lib/queries/portal.ts:563-566` filters `.eq("client_visible", true)`; `:583-585` falls through to `"Working on the project"`. The test that baked the defect in was rewritten (`tests/unit/portal-overview-queries.test.ts:223-249`). |
| B3 | AS-013 — phase assignment did not survive a reload | **CLOSED** | `lib/actions/tasks.ts:2833` selects `phase_id`, `:3312` returns `phaseId`. `task-detail-sheet.tsx:1198-1202, 1743-1747` fall back to `task.phaseId ?? null`, and `confirmedPhaseId` is reset only on a task-**id** change (`:813`), not on every re-sync. `editTask` persists it (`:1116-1118`) with a cross-project check (`:1035-1047`). |
| B4 | AS-014 — write-side page-fields gate still on the type *name* | **CLOSED** | `components/task/task-detail-sheet.tsx:1970` is now `task.taskTypeSystemKey === "page"`. Repo-wide grep finds no remaining name-based page comparison. |
| B5 | AS-014 — `system_key` had no write path; backfill stranded workspaces | **CLOSED, but the new backfill is a blocker of its own** | Write path added and admin-gated (`lib/actions/task-types.ts:113-152`, `lib/validation/task-types.ts:33-35`, `components/workspace/task-type-manager.tsx`), 23505 mapped to plain language, four integration tests. Backfill widened — see BX-1. |
| B6 | AS-003 / AS-031 — unimplemented, tests assert constants and JSX | **RECLASSIFIED: sequencing, not defect** | `plan.md:159` states the risk banner is "wired in M3; until then the component exists and renders nothing", and `plan.md:224` assigns AS-031 to F014 (M3). AS-003's `deliverablesPastDue` needs F012's `deliverables` table (M3, `plan.md:219-220`). `lib/queries/portal.ts:449-470` returns a literal `0` and `[]` with a comment naming the M3 features that give them bodies. This is the no-fabricated-data rule working as designed. **Not counted against M1.** Test-quality caveat retained as a minor. |

**Did the `portal_enabled` gate get applied to every read that needs it, or only the two named functions?** Neither, exactly. The two named functions were fixed, and three more workspace-scoped reads still take an unfiltered `projects` list — `getPortalOverview` (`portal.ts:917-920`), `getPortalActivitySummary` (`:1035-1039`), `getPortalFiles` (`:1155-1158`). Those three are **not live leaks**, because `tasks_select_active_members` (`20260909010000:194-206`) folds `portal_enabled` into the client branch at the database, so the disabled project contributes no rows to any of them. The disabled project's *name* does land in each function's in-memory `projectNames` map and would surface the moment any of them gained a row source that is not `tasks`. Latent, not open.

**Did the phase-name fix simply stop rendering the rail?** No. `getPortalLiveNow` still returns an entry for every non-client timer; only the *label* changes, and only when the phase is hidden. Verified by reading `:572-596` and by the new test at `portal-overview-queries.test.ts:223-249`, which asserts one entry with the generic label — not zero entries.

---

## 2. Assertion table

| ID | Verdict | Change | Reason |
|---|---|---|---|
| AS-001 | PASS | ↑ from PASS | `buildPortalNavItems` (`portal-sidebar.tsx:76-104`) is still exactly the eight, in order. Files/Requests are a separate `buildPortalSecondaryNavItems` group, visually separated on desktop by `mt-2 border-t pt-2` (`:275`). Mobile merges the two groups into one flat strip with no divider (minor, NM-8). |
| AS-002 | **FAIL (major)** | unchanged | `page.tsx:111` feeds the project-scoped `badges.approvalsAwaiting` into the tile while the list below is fed workspace-wide `getPortalOverview(workspace.id)` (`:94`) with a `category !== 'done'` predicate the tile lacks. `portal.ts:439-446` still returns `count ?? 0` after logging an error, rendered as "Nothing waiting on you". Untouched by the remediation. |
| AS-003 | **DEFERRED (sequencing)** | ↑ from FAIL (blocker) | `deliverablesPastDue: 0` is still a literal (`portal.ts:447`), but `deliverables` is F012 in M3. Correct behaviour for M1 under the no-fabricated-data rule. |
| AS-004 | PASS | ↑ from FAIL (major) | `resolvePortalStaticTitle` (`portal-topbar.tsx:83-91`) derives the title synchronously from `usePathname` for all ten static routes including `files` and `requests`; `t/[taskId]` announces its own title through `PortalTitleProvider`. No setState-in-render, no hydration mismatch, cleanup on unmount. Residuals NM-9/NM-10 below. |
| AS-005 | PASS | unchanged | |
| AS-006 | PASS | unchanged | `git diff 7e2fc79 c616961` on both layouts is JSX-wrapping only. The guard chain in `[workspaceSlug]/layout.tsx:56-84` — auth → workspace → role → `canViewClientPortal` — is untouched, unconditional, server-side. |
| AS-007 | PASS (with residual majors) | ↑ from FAIL (blocker) | 404 clause holds via `p/[projectId]/layout.tsx:66-71`. Row clause holds for every live portal read, at the query builder for two functions and at RLS for the rest. Residual write paths NM-3/NM-4 and the untested SELECT-policy half NM-6b. |
| AS-008 | PASS (fragile) | unchanged | `reorderPhases` (`lib/actions/phases.ts:481-496`) is still two independent UPDATEs in `Promise.all` with no transaction and no unique `(project_id, position)`. Ordering is not guaranteed by the schema. |
| AS-009 | PASS | ↑ from FAIL (blocker) | `create_project_from_template` (`20260915010000:115-131`) inserts the template's phases in the same plpgsql invocation as the project and its tasks, in array order, 1-based position, `search_path = public, pg_temp`. Rollback proved by `tests/integration/project-from-template.test.ts:376`. Old 5-arg overload dropped; grants match the original exactly; no other caller. Caveat NM-2. |
| AS-010 | PASS | unchanged | |
| AS-011 | **FAIL (major)** | unchanged | `getProjectPhases` (`portal.ts:302-317`) still logs a failed `project_statuses` read and then computes a confident figure from an empty map — every task falls to `not_started`, every phase reports 0% with a correct-looking denominator. `tests/unit/portal-phases-query.test.ts` mocks a chain that discards its own `.eq()` arguments. Untouched. |
| AS-012 | PASS | ↑ from FAIL (blocker) | See B2. Test fragility NM-6c. |
| AS-013 | PASS | ↑ from FAIL (blocker) | See B3. The genuine regression guard is `tests/integration/f002-phase-management.test.ts:465`, which calls the real `getTaskDetail` — not the unit test whose comment claims that role (NM-6a). |
| AS-014 | PASS (fragile) | ↑ from FAIL (blocker) | See B4/B5. Fragile because of BX-1. |
| AS-015 | **FAIL (major)** | unchanged | `clientStatusLabel` (`components/portal/status-label.ts:8-16`) still resolves a client-facing phrase by `/review/i` on the status name, in the module F004 designated as the single home for the concept. Bucket→label map still triplicated across `pages-table.tsx:39-44`, `status-distribution.tsx:27-32`, `status-manager.tsx:81-87`, with the third already diverged. A null `status_id` still renders a coloured pill with an empty label. Untouched. |
| AS-016 | INCONCLUSIVE | unchanged | Plumbing correct and tested end to end; every pre-existing project still has `client_description = null` with no backfill. |
| AS-017 | **FAIL (major)** | unchanged | `status-label.ts:44-48` still maps `not_started → "waiting"` and `status-distribution.tsx:28` still labels that bucket "Waiting on you". A Backlog page nobody has started is reported to the client as blocked on them, and appears in the Pages distribution's "Waiting on you" while appearing nowhere in the Overview's list of the same name. Untouched. |
| AS-018 | PASS | unchanged | |
| AS-031 | **DEFERRED (sequencing)** | ↑ from FAIL (blocker) | `getPortalRisks` still `return []` (`portal.ts:467-469`), with a comment naming F014/M3 as the feature that gives it a body. `plan.md:159` sanctions this explicitly. Not counted against M1. |

---

## 3. Open items, ranked

### BLOCKER

**BX-1 — the widened `system_key` backfill aborts the deploy on a workspace that already has a tagged page type.**
`supabase/migrations/20260915020000_task_type_system_key_backfill_widen.sql:38-55`.

```sql
with candidates as (
  select distinct on (workspace_id) id
  from task_types
  where system_key is null
    and btrim(name) ilike any (array['page', 'pages', 'sida', 'stranica'])
  ...
)
update task_types set system_key = 'page' where id in (select id from candidates);
```

`distinct on (workspace_id)` de-duplicates **among candidates**. It does not exclude
workspaces that already hold a row with `system_key = 'page'`, and the `where` clause
filters only on `system_key is null`.

Triggering state — and it is the ordinary one, not an exotic one:
* every workspace created since `20260912010000` is seeded with `('Page', …, 'page')`
  by `create_workspace_with_owner` (`20260912010000:88-90`), and that migration's own
  backfill tagged every pre-existing row named `page`; **plus**
* any *other*, untagged row named `Pages` / `Sida` / `Stranica`. Those names coexist
  legally — `task_types_workspace_id_name_idx` (`20260903040000:25-26`) is on
  `(workspace_id, name)`, and it is case-sensitive.

The UPDATE writes `system_key = 'page'` onto that second row → duplicate key on the
partial unique index `task_types_workspace_id_system_key_idx`
(`20260912010000:27-29`) → SQLSTATE 23505 → the file fails.
`scripts/apply-migration.mjs:63-68` posts the whole file as one query and records the
version only on success, so the migration is not recorded and the deploy stops.

This is precisely the population the migration was written for: a Swedish agency with
the seeded English `Page` **and** their own `Sida`. The migration's own comment
(lines 28-37) asserts it "can never itself trip the partial unique index it's writing
into" — that reasoning is sound only within the candidate set, and the comment does
not consider already-tagged rows. The same root cause makes the file non-idempotent,
contradicting its line-16 claim.

CI cannot catch this: migrations are replayed against an empty local stack where
`task_types` has no rows at replay time.

Missing guard:
```sql
and not exists (
  select 1 from task_types t2
  where t2.workspace_id = task_types.workspace_id and t2.system_key = 'page'
)
```

Secondary, same file: the `distinct on` tie-break has no `, id` in the `order by`, so
`"Page"` + `"page"`, or `"Page"` + `"Page "` (the trailing-space case the migration
deliberately courts via `btrim`), rank equal and the winner is plan-order dependent.

Not a defect, for the record: the patterns are `ilike` **without** wildcards, so
`"Page design"`, `"Homepage"` and `"Landing page"` do not false-positive.

### FAILING ASSERTIONS CARRIED FORWARD (major, unaddressed)

* **AS-002** — `app/(portal)/portal/[workspaceSlug]/p/[projectId]/page.tsx:94, 111` +
  `lib/queries/portal.ts:439-446`. Two surfaces, two scopes, two predicates; a failed
  count renders as "Nothing waiting on you". Trigger: a client on two projects, or a
  dropped connection.
* **AS-011** — `lib/queries/portal.ts:302-317`. Trigger: any `project_statuses` read
  failure; a fully delivered phase reports 0% with a correct denominator.
* **AS-015** — `components/portal/status-label.ts:8-16`; `pages-table.tsx:39-44`,
  `status-distribution.tsx:27-32`, `status-manager.tsx:81-87`; `portal.ts:1319, 1344`.
  Trigger: a status named "…review"; a task with `status_id = null`.
* **AS-017** — `components/portal/status-label.ts:44-48`,
  `status-distribution.tsx:28`. Trigger: any page in a `not_started` status with no
  explicit `client_bucket` — e.g. the F005 fixture's own "Backlog" page
  (`tests/integration/f005-portal-pages.test.ts:202-207`).

### NEW MAJORS INTRODUCED OR EXPOSED BY THE REMEDIATION

**NM-1 — `seed_default_phases` closed the role half of its gap and left the visibility half open, and the injected rows are client-visible.**
`supabase/migrations/20260914010000_f006d_authz_gaps.sql:61`. The guard is now
`v_caller_role is null or v_caller_role in ('viewer','client')` — the exact complement
of `is_project_workspace_writer` (`20260908010000:83`), correct as far as it goes, and
it breaks no legitimate caller (the only production caller is
`seedDefaultPhasesImpl`, `lib/actions/phases.ts:542`, whose `withAuthz` default
`canWrite` admits `member` and `guest`; no trigger calls it;
`create_project_from_template` inlines its own inserts).

But that Server Action's gate is **two** checks — `requireWrite` *and*
`requireVisibility: true` (`lib/actions/phases.ts:527-535`). Only the role half was
ported into the function body. Trigger: a workspace `member` or `guest` who is not in
`project_members` for a `visibility = 'private'` project — for whom the Server Action
returns "You don't have permission to manage this project's phases" — calls
`POST /rest/v1/rpc/seed_default_phases` directly and inserts ten rows.
`project_phases.client_visible` defaults to `true`, so those injected phases then
render in that project's client portal. Same defect class the same commit fixed one
function away in `bulkSetTaskPhase`. Also unchecked: `projects.deleted_at`.

Fix: `and public.is_project_visible_to(p_project_id)` in the guard at line 61.

**NM-2 — `create_project_from_template` silently drops `client_visible` on the template round trip.**
`lib/actions/templates.ts:881-885` selects only `name, client_description` when saving
a project as a template, and `20260915010000:119-130` leaves `client_visible` at its
column default of `true`. A phase deliberately set `client_visible = false` in the
source project comes back **client-visible** in every project created from that
template — and `project_phases` is exactly what the portal renders. The migration
comment (lines 29-32) justifies dropping `state` and dates as "never a snapshot of an
in-flight project's current progress" and folds `client_visible` into that rationale;
visibility is a privacy decision, not progress.

**NM-3 — `client_requests` UPDATE and DELETE author policies are still ungated on `portal_enabled`.**
`supabase/migrations/20260902030000:132-141` and `:162-166` are untouched by
`20260913010000`, whose own header claims "a direct PostgREST call is closed too, not
only the app's own query." SELECT and INSERT now carry the conjunct; UPDATE and DELETE
do not. Trigger: a client holding a request id on a project whose portal was
subsequently disabled can still `PATCH` and `DELETE` that row over PostgREST, and
`withdrawClientRequest` (`lib/actions/client-requests.ts:180-183`) resolves the row on
the admin client, so the app path works too — even though they can no longer read it.

**NM-4 — `assert_portal_task_actionable_by_client` has no `portal_enabled` check.**
`supabase/migrations/20260906010000_portal_task_actions_project_visibility.sql:35-80`.
SECURITY DEFINER, so RLS never runs inside it. It checks workspace client membership,
`is_project_visible_to`, `client_visible` and `pending_client_approval` — but not
`is_project_portal_enabled`. Trigger: a client of a portal-disabled project with a
known task id calls `approvePortalTask` / `requestPortalTaskChanges`
(`lib/actions/portal-approval.ts:96-125, 208`) and clears the approval flag on a
project they can no longer see. The follow-on trail comment *is* blocked, because
`is_task_visible_to` folds `portal_enabled` in — so the flag flips while the comment
insert fails, leaving inconsistent state. F006b's audit was self-scoped to *reads*, so
this write path was never in view.

**NM-5 — Files and Requests are now reachable at a URL that lies about their scope.**
`components/portal/portal-sidebar.tsx:118-123` links
`/portal/<slug>/p/<projectId>/files` and `…/requests`, but
`app/(portal)/portal/[workspaceSlug]/p/[projectId]/files/page.tsx:29` and
`…/requests/page.tsx:24` destructure only `workspaceSlug`, and
`getPortalFiles` / `getPortalRequests` / `getPortalProjectOptions` are all
workspace-wide. Trigger: a client with two portal-enabled projects clicks "Files"
inside Project A's shell and gets Project B's files under a URL that names Project A.
The M1-scrutiny FU-9 recommendation to scope both queries to the project was not
carried out; only the navigation half was.

**NM-6 — three test gaps that make green tests non-evidence.**

* **(a) `bulkSetTaskPhase`'s allow case never runs the code it claims to.**
  `tests/integration/f002-phase-management.test.ts:672` signs in as the **owner**, and
  `lib/actions/phases.ts:827-828` short-circuits on `role !== "owner" && role !== "admin"`
  before `explicitMemberProjectIds` is ever consulted. The comment says "ownerEmail IS
  an explicit `project_members` row … so the private-project gate must not reject" —
  describing a path that never executes; the fixture row at `:207-211` is dead.
  Consequence: break the `project_members` lookup at `phases.ts:804-808` (wrong column,
  wrong filter, wrong user id) and the deny test still passes (fails closed) and the
  allow test still passes (owner bypass). Nothing exercises a hit.
  The deny test at `:629` also asserts only `failedIds[0]?.id`, never `.reason`, so a
  "Task not found." rejection is indistinguishable from the visibility gate.
  There is also no mixed-batch test anywhere in the file — every `succeededIds`
  assertion is all-succeed or all-fail, so the partial-success contract the function's
  doc comment leads with is untested for phases.
* **(b) nothing tests the SELECT-policy half of `20260913010000`.**
  Revert `client_requests_select_author_or_team` to its `20260902030000` form and every
  test still passes, because `getPortalRequests`' TypeScript `project_id in (...)`
  filter hides the row before the policy is consulted. The fixture inserts a request
  against the disabled project (`f003-portal-shell.test.ts:340-348`) but only reads it
  back through `getPortalRequests`, never via
  `clientSession.from("client_requests").select()`.
* **(c) the AS-012 unit test does not assert the filter's value.**
  `tests/unit/portal-overview-queries.test.ts:85-93` mocks
  `select: () => ({ eq: () => ({ in: () => phaseRows }) })`, discarding both arguments.
  Deleting `.eq("client_visible", true)` fails the test only incidentally — `select()`
  would then have no `.in` method. Changing it to the wrong column, or to `false`,
  keeps every test green. `tests/unit/portal-phases-query.test.ts:22-56` has the
  identical weakness. The genuine coverage is
  `tests/integration/portal-phases-rls.test.ts:233, 244`, which is `describe.skipIf`'d
  without live credentials.

**NM-7 — F006d's migration header makes a materially false claim about the sweep.**
`20260914010000:13-21` states that "a broader repo-wide grep" found exactly three
unpinned SECURITY DEFINER functions (`accept_client_request_atomic`,
`change_workspace_slug_atomic`, `check_doc_folder_scope`). Taking the **last**
definition of each function name by migration filename order, and excluding the ~11 on
`search_path = ''` (which are safe — an empty path never reaches `pg_temp`), **~42**
SECURITY DEFINER functions are still `set search_path = public` with no `pg_temp`,
including eight live RLS predicates: `is_project_workspace_member`,
`is_task_workspace_member`, `is_project_workspace_admin`, `is_project_visible_to_row`,
`is_task_client`, `is_workspace_client`, `is_project_lead_or_workspace_admin`,
`can_modify_comment`. The mission-scoped sweep the comment defines as its actual scope
*is* complete — every `20260906`–`20260915` function is pinned, verified — but the
parenthetical will be read as "only three remain" by whoever picks up the follow-up.

### CARRIED MAJORS STILL OPEN (from M1-scrutiny.md, out of the remediation's scope)

* **M3** — the three `project_phases` write policies (`20260909010000:163-183`) still
  gate on `is_project_workspace_writer(project_id)` alone, with no
  `is_project_visible_to` conjunct, unlike `project_statuses_insert_admin`
  (`20260828040000:76-83`). The SELECT policies do gate on visibility (`:141-160`); the
  write policies do not. A workspace `member`/`guest` who is not a project member of a
  private project can `POST /rest/v1/project_phases` for it. Not over-restrictive in
  the other direction: a legitimate project member, and an owner/admin who is not in
  `project_members`, can both still manage phases — verified.
* **M5** — `components/portal/phase-timeline.tsx:163-185`, dateless phases drawn at
  invented coordinates on a real week axis; `MIN_BAR_WIDTH_PX = 24` draws a 1-day phase
  as 4 days and an inverted range as a 4-day bar. Untouched.
* **M10** — `reorderPhases` (`lib/actions/phases.ts:481-496`) non-atomic two-row swap.
  Untouched.
* **M11** — the error-as-empty-data sweep across `lib/queries/portal.ts`
  (`:117, 139-142, 302-317, 740-746, 802-828, 1118-1141`). Untouched;
  `getPortalProjectOptions` at `:775-781` still never binds `error`.

### MINORS

* **NM-8** — the mobile nav (`portal-sidebar.tsx:310-326`) renders the eight primary
  and two secondary rows into one flat `<nav>` with no divider or heading, so below
  `md` a reader sees a ten-item strip. Related and **pre-existing** (from 3533d19, not
  a remediation regression): `NavRow` hardcodes `w-full shrink-0`
  (`portal-sidebar.tsx:166`) inside a `flex … overflow-x-auto` container, so every item
  is as wide as the nav and the mobile strip shows one item at a time — now ten swipes
  instead of eight. Neither `<nav>` carries an `aria-label`, and the secondary group is
  a bare `<div>` with no role.
* **NM-9** — `resolvePortalStaticTitle` (`portal-topbar.tsx:83-90`): when `pathname`
  does not start with `basePath`, `rest` falls back to the whole pathname,
  `rest.split("/")[0]` is `""`, and `STATIC_ROUTE_TITLES[""]` returns **"Overview"** —
  the exact failure mode the refactor set out to remove, reintroduced on the
  out-of-base branch. Hard to reach today; the fallback should be an explicit guard.
* **NM-10** — `usePortalTitleOverride()` is applied unconditionally
  (`portal-topbar.tsx:125`) with no check that the route is still a task route, so
  navigating task → Overview leaves a window where the Overview page is titled with the
  previous task's name (the announcer's cleanup is a passive effect, running after
  commit). `tests/unit/portal-title-context.test.tsx:63-85` covers this transition and
  passes only because RTL's `rerender` is `act()`-wrapped. One-line fix: gate the
  override on `firstSegment === "t"`. Same reason the first-paint "Task" placeholder
  (`portal-topbar.tsx:88`) is invisible to the suite.
* **NM-11** — no `PortalTopbar` render test at `/files` or `/requests`. The
  `resolvePortalStaticTitle` unit tests would all still pass if `PortalTopbar` were
  reverted to the old `buildPortalNavItems[0]` lookup, and so would
  `test_AS_004_view_title_tracks_the_active_route` (Results is in the nav list). The
  M7 regression could return undetected.
* **NM-12** — `bulkSetTaskPhase` diverges from its precedent in two non-authz ways:
  `succeededIds` is `allowedIds` (`phases.ts:858`) rather than ids read back from the
  write, where `bulkUpdateTasks` uses `UPDATE … .select()` (`tasks.ts:4149-4156`); and
  it performs no revalidation at all, where `bulkUpdateTasks` and `bulkDeleteTasks`
  both call `revalidateWorkspaceForTaskAssignment`. Neither is exploitable; both are
  unexplained asymmetries with the precedent the function's comment claims to mirror.
* **NM-13** — `updateTaskType`'s 23505 branch (`lib/actions/task-types.ts:145-152`)
  keys on `systemKey !== undefined`, not on the constraint name, so a call carrying
  both a `name` and a `systemKey` that collides on the **name** gets the page-type
  message. Not reachable from the current UI.
* **NM-14** — `task-type-manager.tsx:134-137` renders `value="none"` for a row whose
  `system_key` is `qa`/`seo`/etc. while the "Portal" badge above says it has a role;
  choosing "Portal's page type" silently overwrites the other tag. Latent — only `page`
  is wired today.
* **NM-15** — `SelectValue`'s fallback in the task detail sheet is `?? value`
  (`task-detail-sheet.tsx:1760-1761`), so if `getProjectPhaseOptions` errors
  (→ `setPhaseOptions([])`, `:1025`) a task with a phase renders the raw UUID in the
  trigger.
* **NM-16** — `is_project_portal_enabled` still has no `revoke … from public`
  (grep across all migrations returns nothing), unlike `seed_default_phases` in the
  same file. SECURITY DEFINER and not scoped to `auth.uid()`, so any authenticated
  caller can learn any project's portal state given its UUID. Carried from
  M1-scrutiny.md's minors; unaddressed.
* **NM-17** — `taskTypeName` is now plumbed through `getTaskDetail` and
  `TaskDetailSheetTask` but read nowhere (dead field). `phases: z.array(...).default([])`
  (`lib/validation/templates.ts:169`) defaults on a *missing* key, not on an explicit
  `"phases": null`; no writer produces `null` today.
* The remaining minors from M1-scrutiny.md (`progressPercent` contradicting `state`;
  `getPortalLiveNow`/`getPortalTeam` not independently correct; the task page not
  checking its URL's `projectId`; `getPortalActivitySummary` writing during render;
  cross-project bleed on the project overview; the off-palette seeded task-type colour;
  UTC "today"; `tasks.phase_id` with no same-project constraint; the duplicated Hours
  card and third date formatter; `page-travel-strip`'s seven-step pipeline) are all
  **unchanged** — none of the four remediation features touched their files.

---

## 4. Found while reviewing, outside M1's assertions

These are not M1 defects and should not gate the milestone, but they are the widest
holes surfaced by this review and each sits in code an M1 feature re-created or
imported.

1. **`create_channel_atomic` has no authorization whatsoever.**
   `20260914010000:108-137` — SECURITY DEFINER, `grant execute … to authenticated`,
   body is two unguarded INSERTs using caller-supplied `p_workspace_id`,
   `p_created_by` and `p_member_ids`, with no membership check and no `auth.uid()`
   comparison. Any authenticated user can create a channel in any workspace, attribute
   it to any user, and add arbitrary members. Pre-existing (from `20260905090000`), but
   F002b and F006d have now each re-created this function — the second time under an
   "authz gaps" banner — without adding a guard.
2. **`app/api/extension/context/route.ts` returns workspace data to a `client` role.**
   `:150-155` gates on `requireActiveMembership` only, with no role check. A `client`
   is an active workspace member, so the endpoint returns every `visibility='workspace'`
   project's id and name (`:238-241`) plus the full active-member roster (`:186-193`),
   read on the admin client — bypassing both `is_project_visible_to`'s client branch and
   `portal_enabled` entirely. Attributed to a different mission (AS-557), but it is the
   single widest breach of "a client sees nothing of a project that isn't shared with
   them" that this review found.
3. **`getAttachmentSignedUrl`** (`lib/actions/attachments.ts:110-232`) runs on the
   admin client and checks membership, `client_visible` and project visibility, but not
   `portal_enabled`. A client with an attachment id can still mint a signed URL for a
   shared attachment on a portal-disabled project.

---

## 5. Recommended follow-up features

**FU-15 (blocker, AS-014) — Make the `system_key` backfill collision-proof and deterministic.**
Add a new migration (do not edit `20260915020000`; it may already be recorded as
applied on some instances) that repeats the widened backfill with two corrections: a
`not exists (select 1 from task_types t2 where t2.workspace_id = task_types.workspace_id
and t2.system_key = 'page')` guard so a workspace that already has a tagged page type is
skipped entirely, and `, id` appended to the `distinct on` `order by` so the winner
among equal-ranked names is deterministic. Then make the original file safe to replay
by the same means, or wrap the update in an `on conflict do nothing`-equivalent
(`update … where … and not exists (…)`) so re-running it is a no-op rather than a
23505. Add an integration test that seeds a workspace with a tagged `Page` **and** an
untagged `Sida`, runs the statement, and asserts it neither errors nor changes the
tagged row — the current suite cannot see this because CI replays migrations against an
empty database. While there, consider whether the natural plurals (`sidor`, `stranice`)
belong in the pattern list, and whether an in-app "your workspace has no page type
tagged" hint on the team side is a better long-term answer than any name list.

**FU-16 (major, authorization) — Finish `seed_default_phases`'s guard and align the `project_phases` write policies.**
One migration, three changes. (a) Add `and public.is_project_visible_to(p_project_id)`
to `seed_default_phases`'s guard (`20260914010000:61`), plus a `projects.deleted_at is
null` check, so the RPC boundary enforces both halves of what
`seedDefaultPhasesImpl`'s `withAuthz` enforces — today only the role half is there, and
the injected phases default to `client_visible = true`, so they reach the client
portal. (b) Add `is_project_visible_to(project_id)` to the three `project_phases`
write policies (`20260909010000:163-183`), matching `project_statuses_insert_admin`'s
own shape. (c) Fold `portal_enabled` into `client_requests_update_author_while_submitted`
and `client_requests_delete_author_while_submitted`, so all four client-facing verbs on
that table agree with each other and with `20260913010000`'s own stated standard. Test
each as a direct PostgREST call by a workspace `member` who is not a project member of
a private project, and by a client whose portal was disabled — both must get 42501,
and a legitimate project member must still succeed (positive control).

**FU-17 (major, AS-007) — Close the portal write paths the read audit did not cover.**
F006b audited every *read* against the five client-visibility tables. The write side
still has three gaps: `assert_portal_task_actionable_by_client`
(`20260906010000:35-80`) never checks `is_project_portal_enabled`, so a client of a
portal-disabled project can still clear `pending_client_approval` through
`approvePortalTask` / `requestPortalTaskChanges` — and the follow-on trail comment
fails while the flag flips, so the state ends up inconsistent; `getAttachmentSignedUrl`
(`lib/actions/attachments.ts:110-232`) mints signed URLs for a disabled project's
attachments; and `app/api/extension/context/route.ts:150` has no role gate at all, so a
`client` receives every workspace-visible project and the full member roster. Add the
`portal_enabled` conjunct to the first two and a role gate to the third, then write a
single "client of a portal-disabled project" integration fixture that walks every
client-reachable action and asserts each is rejected — the per-function audit is what
let a write path slip through a read-shaped review.

**FU-18 (major, AS-009) — Round-trip phase visibility through the template.**
`saveProjectAsTemplate` (`lib/actions/templates.ts:881-885`) selects only `name,
client_description`, and `create_project_from_template` leaves `client_visible` at its
`true` default, so a phase deliberately hidden from the client in the source project
comes back visible in every project created from that template. Add `client_visible` to
the template payload schema (`lib/validation/templates.ts`), to the save query, and to
the RPC's insert list, defaulting to `true` for templates saved before the change. Test
a save→create round trip on a project with one hidden and one visible phase and assert
both flags survive.

**FU-19 (major, test integrity) — Replace the three tests that cannot fail.**
Three specific rewrites, and one general rule. (a) Change
`f002-phase-management.test.ts:672`'s actor from the owner to a plain `member` who has
a `project_members` row for the private project, so the allow case actually executes
`explicitMemberProjectIds`; assert `failedIds[0].reason`, not just `.id`, in the deny
case at `:629`; add a mixed-batch case asserting one succeeded and one failed with both
DB rows checked. (b) Add a direct `clientSession.from("client_requests").select()` to
`f003-portal-shell.test.ts` so the SELECT half of `20260913010000` is proven at the
database, not hidden behind `getPortalRequests`' own TypeScript filter. (c) Give
`portal-overview-queries.test.ts` and `portal-phases-query.test.ts` mocks that honour
their `.eq()` arguments — a filter builder that actually filters the fixture array —
so changing `client_visible` to `false` or to a different column fails the test on an
assertion rather than on a missing method. The general rule worth encoding somewhere
the workers read: a mock whose chain methods discard their arguments is not coverage of
a query's predicate, only of its shape.

**FU-20 (major, AS-007/UX) — Scope Files and Requests to the project whose shell wraps them.**
`portal-sidebar.tsx:118-123` now links both at `/p/<projectId>/…`, but
`files/page.tsx:29` and `requests/page.tsx:24` ignore `projectId` and their queries are
workspace-wide. Add a `projectId` parameter to `getPortalFiles`, `getPortalRequests`
and `getPortalProjectOptions` (or scope them at the call site), so the page shows the
project the URL and the surrounding sidebar both name. While there, close the two
navigation residuals: guard `usePortalTitleOverride` on `firstSegment === "t"` so a
task title cannot briefly title the Overview, and make `resolvePortalStaticTitle`'s
out-of-base branch fall through to an explicit guard rather than to
`STATIC_ROUTE_TITLES[""]` = "Overview". Add a `PortalTopbar` render test at
`/p/<id>/files` and `/p/<id>/requests` asserting the rendered `<h1>` — the current
tests exercise the resolver but never prove the topbar is wired to it.

**FU-21 (out-of-scope, security) — Guard `create_channel_atomic`.**
It is SECURITY DEFINER, granted to `authenticated`, and its body is two INSERTs on
caller-supplied `workspace_id`, `created_by` and `member_ids` with no membership check.
Either add `requireActiveMembership`-equivalent checks in the body (`auth.uid() =
p_created_by`, caller is an active member of `p_workspace_id`, every `p_member_ids`
entry is an active member of the same workspace) or revoke `authenticated` and route
every caller through the Server Action on the service role. Attributed to an earlier
mission, but M1 re-created this function twice and both times carried the gap forward.

**FU-1 … FU-14 from `M1-scrutiny.md`:** FU-1, FU-2, FU-3, FU-4, FU-5 and FU-12 are
**closed** by this remediation. FU-6 is **partly closed** — (a) role half only,
(b) not done, (c) not done, (d) done. FU-7, FU-8, FU-9 (navigation half only), FU-10,
FU-11, FU-13 and FU-14 remain **open exactly as written**.

---

## 6. Design-constraint compliance (delta only)

| Constraint | Result |
|---|---|
| 1. Tokens only, no hex in components | **PASS**, unchanged. The one hex in a migration (`20260912010000:89`) is unchanged. |
| 2. Reuse before building | **PARTIAL**, unchanged — the duplicated Hours card, triplicated bucket→label map and third date formatter all survive. |
| 3. Status semantics added once | **PARTIAL**, unchanged — `clientStatusLabel`'s name regex survives beside `resolveClientBucket`. |
| 4. State never colour alone | **PARTIAL**, unchanged — the null-`status_id` pill is still colour-only. |
| 5. RLS pattern + `pg_temp` | **Improved to PASS for this mission's own functions.** Every SECURITY DEFINER function added or replaced under `20260906`–`20260915` now pins `public, pg_temp`, verified by an independent sweep taking the last definition of each name. `create_channel_atomic` (M4) is fixed. The repo-wide picture is unchanged and much worse than F006d's header claims (NM-7); the write-policy deviation (M3) is unchanged. |
| 6. Multi-table writes via RPC | **PARTIAL** — improved: `create_project_from_template` now writes projects, tasks, checklist items and phases in one transaction. `reorderPhases` (M10) is unchanged. |
| 7. Server fetches, client receives props | **PASS.** `PortalTitleProvider` is `"use client"` but holds only a `useState`; no client component queries Supabase. |

---

## 7. Tooling output

### `npx tsc --noEmit`
Clean — no output, exit 0.

### `npm run lint`
```
> pm-app@0.1.0 lint
> eslint


/Users/sasajapranin/Desktop/pm-app/components/chat/message-list.tsx
   22:26  warning  'SmilePlus' is defined but never used                                                           @typescript-eslint/no-unused-vars
  161:5   warning  Unused eslint-disable directive (no problems were reported from 'react-hooks/exhaustive-deps')

/Users/sasajapranin/Desktop/pm-app/lib/queries/portal.ts
  467:38  warning  '_projectId' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/missions/20260830-223927/milestones/M2-evidence-2/probe.mjs
  23:7  warning  'status' is assigned a value but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/missions/20260830-223927/milestones/M2-evidence/probe.mjs
  23:7  warning  'status' is assigned a value but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/f002-task-detail-sheet-phase-optimistic.test.tsx
  117:4   warning  '_taskId' is defined but never used   @typescript-eslint/no-unused-vars
  117:21  warning  '_phaseId' is defined but never used  @typescript-eslint/no-unused-vars

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
0 errors — identical to the pre-remediation run. The `portal.ts:467` warning is still
the `getPortalRisks` stub parameter, now a sanctioned M3 placeholder rather than a
defect marker.

### Targeted test run
```
npx vitest run \
  tests/unit/portal-overview-queries.test.ts \
  tests/unit/f002-task-detail-sheet-phase-optimistic.test.tsx \
  tests/unit/f006c-task-detail-sheet-page-fields-system-key-gate.test.tsx \
  tests/unit/portal-title-context.test.tsx \
  components/portal/portal-sidebar.test.tsx \
  components/portal/portal-topbar.test.tsx

 Test Files  6 passed (6)
      Tests  49 passed (49)
   Duration  2.55s
```

Full vitest suite not run, per instruction (a second concurrent run manufactures
Supabase auth rate-limit failures and another agent is working in the repo). The
integration suites touched by this remediation — `f002-phase-management`,
`f003-portal-shell`, `f006c-task-type-system-key-write-path`,
`project-from-template`, `portal-phases-rls` — were read line by line, not executed;
they require live Supabase credentials and are `describe.skipIf`'d without them. Every
FAIL and every test-quality finding above is derived from reading the test source
against the code it claims to cover, and is independent of whether those suites
currently pass.
