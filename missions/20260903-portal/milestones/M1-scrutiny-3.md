# M1 Scrutiny — Round 3 (final)

Mission: 20260903-portal · Milestone M1 (F001–F006 + remediation F006a–F006k)
Reviewed at: b737fdf / 1157b58 · Scope: narrow, per the three questions asked.
Read-only. No code, test or contract file was modified.

---

## VERDICT

**M1 does not pass.**

Round 2 did what it said it would do. The four carried-forward failures are
in much better shape: **AS-011, AS-015 and AS-017 are now genuinely satisfied**,
and none of the five regression shapes you named actually landed. That work is
real and I am not going to invent objections to it.

But the third question turned up what it was aimed at. **The `portal_enabled`
gate is not closed.** Three partial sweeps left a seam exactly where predicted —
not in RLS, which is now clean, but in the two places RLS does not run: the
`SECURITY DEFINER` RPCs and the admin/service-role client. Four distinct paths
let a client of a `portal_enabled = false` project read or write that project's
data. **AS-007 regresses from PASS to FAIL (blocker).**

**AS-002 also remains FAIL**, though for a different and narrower reason than in
rounds 1 and 2: the tile/list divergence is genuinely fixed; the badge's own
predicate is wrong, and its test cannot see that it is wrong.

---

## Q1 — The four carried-forward assertions

| ID | R2 | R3 | Reason |
|---|---|---|---|
| AS-002 | FAIL (major) | **FAIL (major)** | Tile/list divergence fixed. New ground: `lib/queries/portal.ts:512-516` counts every `state='pending'` approval on the project with no `project_decision_owners` filter, so it is not "awaiting **this** client's decision". |
| AS-011 | FAIL (major) | **PASS** | Fixed and well tested. |
| AS-015 | FAIL (major) | **PASS** | Fixed. One overclaiming comment, minor. |
| AS-017 | FAIL (major) | **PASS** | Fixed. Sums hold by construction, not by luck. |
| AS-007 | PASS | **FAIL (blocker)** | Regression in judgement, not in code — see Q3. The four holes below were present in round 2 and neither of my earlier passes reached them. |

### AS-011 — PASS

`getProjectPhases` (`lib/queries/portal.ts:322-419`) is correct on numerator and
denominator. The task query at `:352-358` carries `.eq("client_visible", true)`
and `.is("deleted_at", null)`, and `entry.total` (`:393`) is incremented from
that same filtered set — there is no wider count anywhere in the arithmetic.
All three failure paths (`:341-344` phases, `:369-372` tasks, `:374-376`
statuses) return `{ ok: false }`; nothing reaches the category map via `?? []`.
The sole call site (`app/(portal)/portal/[workspaceSlug]/p/[projectId]/page.tsx:153-166`)
branches on `.ok` and renders an `EmptyState`. The percentage-from-a-partial-read
defect is genuinely gone.

The test would catch a regression. `tests/unit/portal-phases-query.test.ts:149-191`
seeds `t-hidden` (`client_visible:false`) and `t-deleted`, and the mock helper
(`tests/unit/helpers/query-filter-mock.ts:28-38`) really applies its `eq`/`in`
arguments — delete `.eq("client_visible", true)` from `portal.ts:357` and
`totalClientVisibleTasks` goes 2→4 and the test fails. `:342-412` pins all three
`{ok:false}` paths with `toEqual`, so a computed-percentage fallback cannot be
reintroduced silently.

### AS-015 — PASS

There is now exactly one classifier (`resolveClientBucket`,
`components/portal/status-label.ts:65-77`) and one bucket→label map
(`CLIENT_BUCKET_LABELS`, `:86-91`). All three former copies import it:
`pages-table.tsx:45`, `status-distribution.tsx:78`, `status-manager.tsx:93-95`.
A repo-wide sweep for status-name heuristics (`/review/i`, `toLowerCase()` on a
status name, hard-coded `"In Review"` comparisons) across `components/`, `app/`
and `lib/` returns zero live hits — only two historical mentions inside comments.
The pill's label is `project_statuses.name` verbatim (`status-pill.tsx:110`);
colour derives from category/`client_bucket`, never from the name. Double
resolution is safe: `getPortalPages` resolves the bucket (`portal.ts:1534-1538`)
and `StatusPill` re-resolves (`status-pill.tsx:95`), idempotent because a valid
bucket short-circuits at `status-label.ts:73`.

The genuinely load-bearing test is `status-label.test.ts:91` — a status literally
named "Review" is not classified waiting — which fails the instant anyone
reintroduces the regex.

### AS-017 — PASS

Exactly the four named buckets in AS-017's own order
(`components/portal/status-distribution.tsx:21`), labelled from the shared map,
and **every** count rendered as text in the `<dl>` including zeros (`:71-82`);
only the decorative bar omits empty segments (`:45`), and it is `aria-hidden`
with the key as the accessible content (`:56`).

Sum integrity is structural, not incidental. `PortalPage.status.clientBucket` is
typed `ClientBucket` (`portal.ts:1397`) and produced by a total function:
`CATEGORY_BUCKET_FALLBACK` covers all three `StatusCategory` values
(`status-label.ts:40-44`), an unrecognised `client_bucket` string is rejected by
`isClientBucket` and falls to the category fallback (`:73`), and a null
`status_id` defaults `category` to `not_started` (`portal.ts:1527`). No page can
map to no bucket; the count loop (`pages/page.tsx:64-66`) increments exactly once
per page; counts sum to `pages.length` by construction. The empty-state early
return (`:44-53`) means the bar never divides by zero.

### AS-002 — FAIL (major)

The half you fixed is fixed. Tile (`page.tsx:119`) and list (`:126-129`) are now
fed the *same array* from `getPortalWaitingOnYou`, and the failure path is honest
(`waitingOnYouCount = null` → "—", `components/portal/overview-tiles.tsx:86-95`;
`waitingOnYouFailed` → `components/portal/portal-overview-live.tsx:167-172`).

The badge is a third predicate in a third layer and it answers a broader question
than the assertion asks:

- `lib/queries/portal.ts:512-516` — `approval_requests` where `project_id = X`
  and `state = 'pending'`. No decision-owner filter.
- The app's own definition of who owes a decision is `project_decision_owners`,
  one user per (project, decision_type) — unique constraint at
  `supabase/migrations/20260916010000_approval_requests.sql:133` — and it is
  enforced server-side at `:417-425` (`42501 'you are not the decision owner for
  this request'`).
- RLS `approval_requests_select_client` (`:176-194`) deliberately does not narrow
  by decision owner, so nothing downstream restores the predicate.

**Trigger.** Two client contacts on one project; `project_decision_owners` maps
`brand`→Anna, `commercial`→Bob. Three pending `brand` requests. Bob opens the
portal: the Approvals badge reads **3**, and all three throw `42501` if he tries
to decide any of them. The number awaiting Bob's decision is 0. Second trigger: a
pending request whose `decision_type` has no `project_decision_owners` row at all
(`v_owner_id is null`) is decidable by nobody, yet is counted for every client.

**And the test cannot see it.** `tests/unit/portal-overview-queries.test.ts:39-44`
is the one mock in that file *not* migrated to `eqFilter`/`applyFilters` — it
discards every `eq` argument:

```js
eq: vi.fn(() => ({ eq: vi.fn(async () => approvalCountResult) }))
```

Delete `.eq("state","pending")` from `portal.ts:516`, change it to
`'approved'`, or drop `.eq("project_id", projectId)` entirely so it counts the
whole table — every AS-002 badge test stays green. Only removing a *link* in the
chain fails it. The integration test
(`tests/integration/f003-portal-shell.test.ts:236-255`) asserts `0` against a
fixture with no approval rows, which proves nothing about the predicate either.
Under the rule that a test confirming the implementation rather than the
assertion's intent counts as a failure, this alone would hold AS-002 at FAIL.

Severity **major**, not blocker: the approvals surface itself is M2 (the route is
still `PortalComingSoon`), and the badge is correct in the single-decision-owner
case the schema explicitly permits. It must land with M2's F008/F009.

---

## Q2 — Did round 2 introduce anything?

All five shapes you named: **no**. Checked specifically, each one clean.

1. **Discriminated result ignored at a call site — clean.** Full sweep of
   `getProjectPhases`, `getPortalBadgeCounts.approvalsAwaiting`,
   `getPortalWaitingOnYou`: `layout.tsx:67`→`portal-sidebar.tsx:96`,
   `page.tsx:90`→`:153`, `page.tsx:98`→`:119`/`:126-129`/`:172`,
   `tests/integration/f003-portal-shell.test.ts:416-418`. Every one branches on
   `.ok`. The `[]` seed at `page.tsx` is paired with an explicit
   `waitingOnYouFailed` flag, so an empty list is never passed off as
   "nothing waiting". No silent coercion anywhere.

2. **`not_started` remap disagreeing across screens — clean.** `not_started` →
   `progress` in the single fallback map (`status-label.ts:41`). The Overview's
   server path resolves through the same function (`portal.ts:1131-1136`), so a
   not-started page is absent from "Waiting on you" there too;
   `getPortalWaitingOnYou`'s flag-only rule also excludes it. All three
   definitions agree on `not_started`. This is the one you were most worried
   about and it did not happen.

3. **The `projects` BEFORE UPDATE trigger blocking a legitimate write — clean.**
   No application code writes `portal_enabled`, `portal_enabled_at`,
   `target_launch_date`, `launch_confidence` or `launch_note` at all today
   (`lib/queries/portal.ts:118,129,859,924` only read/filter them); no plpgsql,
   seed or template function sets them. Every `projects` UPDATE in the app goes
   through the service-role admin client — `lib/actions/projects.ts:315`
   (update), `:480/:499` (archive), `:660/:674` (restore) — and hits the
   `auth.role() = 'service_role'` exemption at
   `supabase/migrations/20260919010000_projects_portal_launch_role_gate.sql:63-65`.
   Project creation is an INSERT; the trigger is UPDATE-only. The one
   session-bound project UPDATE (`lib/actions/project-members.ts:391`,
   `visibility` only) does not touch the five columns, and the trigger compares
   per-column with `is distinct from` (`:68-69`, `:85-87`), so same-value and
   no-op writes pass. The kanban lead-column flow writes `tasks`/
   `project_statuses`, never `projects`. AS-029 is unaffected.

4. **`create_channel_atomic`'s new auth branch breaking the service-role path —
   clean.** Sole caller repo-wide is `lib/actions/chat-channels.ts:144`, invoked
   on `createAdminClient()` (`lib/supabase/admin.ts:11-21`) → `auth.uid()` is
   null → the whole guard block is skipped. It also already passes
   `p_created_by: user.id` (`:147`) and de-dupes memberIds to creator + requested
   (`:117-119`), so it would satisfy the new checks even under a session client.

5. **Team-side writes broken by the `client_requests` / `assert_portal_task_
   actionable_by_client` gating — clean.** `client_requests_update_team`
   (`20260902030000:147-154`) is a separate PERMISSIVE policy predicated on
   `is_project_workspace_writer` with no portal check, so `declineClientRequest`
   (`lib/actions/client-requests.ts:224`, session client) still works on a
   portal-off project. DELETE has only the author policy by design, and the
   author is always a client. `assert_portal_task_actionable_by_client` is
   reached only from the two client-only RPCs.

**One genuine round-2 regression, minor.**

`supabase/migrations/20260918010000_f006i_authz_round_2.sql:65-68` adds
`is_project_visible_to(p_project_id)` to `seed_default_phases`, but that SQL
predicate (`20260908010000:37-64`) excludes role `guest` from its role branch
entirely — a guest is visible only via an explicit `project_members` row, even on
a `visibility = 'workspace'` project. The application-side gate it claims to
mirror does not: `lib/actions/project-visibility.ts:25` returns `true` for any
role when `visibility === 'workspace'`, and `requireWrite` allows guest
(`lib/actions/phases.ts:526-534`).

**Trigger.** A workspace `guest` with no `project_members` row, on a
`visibility = 'workspace'` project, clicks "Add the standard ten phases"
(`components/project/phase-list.tsx:434` → `lib/actions/phases.ts:542`). The
Server Action's own checks pass; the RPC now raises `42501` and the user gets a
generic error. Before this migration the call succeeded (`20260914010000`'s body
only denied `viewer`/`client`). The same guest can still create phases one at a
time, since `project_phases_insert_team` uses `is_project_workspace_writer`
(`20260909010000:162-167`), which permits guest — so the app is now internally
inconsistent about what a guest may do.

Minor rather than major because that guest also cannot SELECT `project_phases`
(`project_phases_select_team`, same predicate), so the phase UI is already empty
for them. Project creation is unaffected: `createProject`
(`lib/actions/projects.ts:124`) never calls the seeder, and
`create_project_from_template` seeds inline without it.

---

## Q3 — Is the `portal_enabled` gate closed? **No.**

RLS is clean. Every client-reachable policy, resolved to its last redefinition,
reaches `is_project_portal_enabled` either directly or through
`is_task_visible_to`, which folds it in at
`supabase/migrations/20260909010000_portal_foundations.sql:213`: `tasks`,
`project_phases`, `approval_requests`, `project_decision_owners`,
`client_requests` (S/I/U/D), `comments`, `attachments`, `checklist_items`,
`time_entries`, `comment_reactions`, `task_dependencies`, `task_activity`,
`task_assignees`, `task_watchers`, and the `task-attachments` storage policy.
The three ungated ones — `project_statuses`, `task_types`, `projects` — are
noted below.

**The seam is everywhere RLS does not run.** Four paths, ranked.

### B1 — blocker — `decide_approval_atomic` has no portal gate at all

`supabase/migrations/20260916010000_approval_requests.sql:348-479`.
`SECURITY DEFINER`, `grant execute … to authenticated` (`:479`). Its only
authorization check is the decision-owner lookup (`:417-425`). No
`is_project_portal_enabled`, no `is_project_visible_to`, no `client_visible`
check on the subject task. F006i fixed the sibling helper
`assert_portal_task_actionable_by_client` for exactly this bug class and never
looked at this RPC, which had landed two migrations earlier.

**Trigger.** As the client:
`POST /rest/v1/rpc/decide_approval_atomic {p_request_id, p_decision:"approved"}`.
It settles `approval_requests.state/decided_by/decided_at`, clears
`tasks.pending_client_approval` on that project's task, writes `audit_log` and a
team notification, and returns `state`/`decided_at` to the caller — on a project
whose portal is off and whose approval rows RLS refuses to show them.

The fixture already exists: `tests/integration/f007-approvals-rls.test.ts:356-390`
inserts `project_decision_owners(disabledProjectId,'content',clientId)` plus a
pending request on `disabledProjectId`, then asserts only that the *reads* return
`[]`. Calling the RPC with that request id from `clientSession` succeeds.

### B2 — blocker — `get_open_task_counts` is an ungated `SECURITY DEFINER` aggregate executable by PUBLIC

`supabase/migrations/20260905010000_perf_task_count_rpc.sql:22-37`.
`SECURITY DEFINER`, `SET search_path = public` (unpinned — the pg_temp shadowing
issue `20260908010000` fixed elsewhere), takes an arbitrary `project_ids uuid[]`,
and performs **no membership, visibility or portal check whatsoever**. There is
no `revoke … from public` in the migration and no blanket
`alter default privileges` anywhere in the tree, so EXECUTE defaults to PUBLIC,
`anon` included. Its own header asserts "the caller's RLS context is still
enforced on the outer query that feeds project_ids" — true for the app's call
site (`lib/queries/projects.ts:108`), false for a direct RPC.

**Trigger.** The client first enumerates project ids: `projects_select_active_members`
(`20260818004709:25-27`) is predicated on `is_active_workspace_member` alone and
does not exclude the `client` role, so `GET /rest/v1/projects?select=id` returns
every project in the workspace including portal-disabled ones. Then
`POST /rest/v1/rpc/get_open_task_counts {"project_ids":["<disabled-id>"]}`
returns the count of every open task in that project, **including
non-`client_visible` ones**. Directly violates AS-007 and AS-054 ("absent from
aggregates and counts").

This function predates the mission, but AS-007 and AS-054 are this mission's
assertions and this is a live count leak against both. Round 2's NM-16
(`is_project_portal_enabled` missing `revoke … from public`) was the same shape
and was not acted on.

### B3 — blocker — `addComment` writes through the admin client with no portal gate, and `requestPortalTaskChanges` reaches it before the gated RPC

`lib/actions/comments.ts:136` takes `createAdminClient()`, so
`comments_insert_active_members` — which *is* gated — never runs. The
compensating checks at `:175-226` cover membership, `client_visible` (`:188`) and
project visibility (`:210-226`), but never `portal_enabled`. The insert at
`:264-275` goes through `admin`.

`lib/actions/portal-approval.ts:183` calls `addComment` **before**
`request_portal_task_changes_atomic` (`:207`) — deliberately, per the header at
`:174-182` (commit f18691a, itself a round-1 remediation). On a portal-disabled
project the RPC now correctly rejects and the client sees an error, but **the
comment has already been persisted** onto that project's task. Same hole reached
directly: any client holding a `client_visible` task id in a portal-off project
can invoke `addComment` and write into it.

### B4 — blocker — `getAttachmentSignedUrl` mints signed URLs through the admin client with no portal gate

`lib/actions/attachments.ts:110-234`. The client-specific check at `:197-199` is
`client_visible` only; project visibility at `:207-218`; no `portal_enabled`. The
signed URL is minted with `admin.storage` at `:220-222`, bypassing
`attachments_objects_select_active_members`, which *is* gated via
`is_task_visible_to`. A client of a portal-disabled project holding an attachment
id on a `client_visible` task gets a working download URL for the file. A direct
read leak — AS-007's "not returned by any portal query" in the plainest sense.

### B5 — medium — `project_statuses` and `task_types` readable on a portal-off project

`supabase/migrations/20260824010000_project_statuses.sql:60-66` gates on
`is_project_visible_to` only. This mission added `project_statuses.client_description`
(`20260909010000`, §4) — client-facing copy — to that table, so
`GET /rest/v1/project_statuses?select=id,name,client_description,client_bucket&project_id=eq.<disabled>`
returns portal-authored content. Same shape, lower value:
`task_types_select_active_members` (`20260903040000:38-42`) returns every
workspace task type to any client.

### The five app-layer admin-client reads in `lib/queries/portal.ts` are fine

`:657` `getPortalLiveNow`, `:764` `getPortalTeam`, `:1187` activity summary,
`:1510` role lookup — each takes a `projectId` already resolved through
`getPortalProjects`' `.eq("portal_enabled", true)` filter in the same request,
and each re-filters `client_visible` locally. Route guards hold too:
`p/[projectId]/layout.tsx` and `page.tsx` both resolve via `getPortalProjects`
and `notFound()` on miss, so AS-007's 404 clause is intact. Realtime is clean
(`client_requests` publication applies per-subscriber RLS and that table is
gated). No client-facing email path for portal data exists.

**Non-regression note (minor):** the F006k trigger is UPDATE-only, so nothing
prevents a client from INSERTing a brand-new project with `portal_enabled = true`
via PostgREST (`projects_insert_active_members`, `20260818004709:32-38`, admits
any active member including `client`). Low value — the new project contains no
one else's data — but the column gate is not complete.

---

## Assertion table (M1 scope only)

| ID | Verdict | Severity | Reason |
|---|---|---|---|
| AS-001 | PASS | — | Unchanged from R2. |
| AS-002 | **FAIL** | major | Badge counts all pending project approvals, not those awaiting this client (`portal.ts:512-516`); its test mock discards every `eq` argument (`portal-overview-queries.test.ts:39-44`). |
| AS-003 | DEFERRED | — | F012/M3. Honest zero. Unchanged. |
| AS-004 | PASS | — | Unchanged from R2. |
| AS-005 | PASS | — | Unchanged from R2. |
| AS-006 | PASS | — | Unchanged from R2. |
| AS-007 | **FAIL** | blocker | B1–B4: four paths let a client read or write a `portal_enabled = false` project. |
| AS-008 | PASS | — | Unchanged from R2. |
| AS-009 | PASS | — | F006h carries `client_visible` through the template round trip. |
| AS-010 | PASS | — | Unchanged from R2. |
| AS-011 | **PASS** | — | Fixed by F006f; regression-proof test. |
| AS-012 | PASS | — | Unchanged from R2. |
| AS-013 | PASS | — | F006j gave the authorisation test the ability to fail. |
| AS-014 | PASS | — | Unchanged from R2. |
| AS-015 | **PASS** | — | Fixed by F006g; one classifier, one label map, zero name heuristics. |
| AS-016 | PASS | — | Unchanged from R2. |
| AS-017 | **PASS** | — | Fixed by F006g; four buckets, all counts in text, sums structural. |
| AS-018 | PASS | — | Unchanged from R2. |
| AS-031 | DEFERRED | — | F014/M3, sanctioned by `plan.md:159`. |

---

## Recommended follow-up features

**FA — Close the portal gate on every `SECURITY DEFINER` RPC and every
admin-client path.** The RLS sweep is complete and correct; the gap is that four
code paths never reach RLS. Add `is_project_portal_enabled(v_project_id)` to
`decide_approval_atomic` alongside its existing decision-owner check
(`20260916010000_approval_requests.sql:417-425`), following the shape F006i
applied to `assert_portal_task_actionable_by_client`. Add the same check to the
client branch of `addComment` (`lib/actions/comments.ts`, beside the
`client_visible` check at `:188`) and `getAttachmentSignedUrl`
(`lib/actions/attachments.ts:197`) — both use the admin client, so the policy
cannot cover them, and both need it stated explicitly. `revoke execute on
function public.get_open_task_counts(uuid[]) from public` and add a caller
membership/visibility predicate to its body, plus `set search_path = public,
pg_temp`. The definition of done is a test per path that signs in as a client of
a portal-disabled project and shows each of the four calls rejected — the
`f007-approvals-rls.test.ts:356-390` fixture already builds the state B1 needs.
Consider a general rule, enforced by a test that enumerates `pg_proc`: every
`SECURITY DEFINER` function granted to `authenticated` that accepts a
project/task id must reference either `is_project_visible_to` or
`is_project_portal_enabled`.

**FB — Make the Approvals badge count what AS-002 says, and make its test able to
prove it.** Join `getPortalBadgeCounts`' `approval_requests` count to
`project_decision_owners` on `(project_id, decision_type)` and restrict to
`user_id = auth.uid()`, so the badge equals the number of requests this client
can actually decide — the same predicate `decide_approval_atomic:417-425`
enforces. Requests with no decision-owner row should be excluded, since nobody
can decide them. Migrate the `approval_requests` mock at
`tests/unit/portal-overview-queries.test.ts:39-44` onto the existing
`applyFilters`/`eqFilter` helper so that dropping or altering any filter fails a
test, and add an integration case with two client contacts and per-type decision
owners asserting each sees only their own count. This belongs with M2's F008/F009
and should gate M2's own scrutiny, not block M1's other work.

**FC — Reconcile the SQL and application definitions of "project visible to a
guest."** `is_project_visible_to` (`20260908010000:37-64`) excludes `guest` from
its role branch; `isProjectVisibleToCaller`
(`lib/actions/project-visibility.ts:25`) admits any role on a
`visibility = 'workspace'` project. F006i's addition to `seed_default_phases`
made this divergence a hard user-visible failure for the first time. Pick one
definition, apply it to both layers, and add a test that a guest on a
workspace-visible project either can or cannot seed phases — consistently with
whether that guest can create phases individually, which today they can.

**FD — Gate `project_statuses` and `task_types` reads on `portal_enabled` for the
client role.** `project_statuses_select_visible`
(`20260824010000_project_statuses.sql:60-66`) and
`task_types_select_active_members` (`20260903040000:38-42`) both predate the
portal and return rows to a client of a portal-disabled project. This mission put
client-facing copy (`client_description`, `client_bucket`) on the first of those
tables, which makes it portal data. Split the client branch out with
`is_project_portal_enabled`, keeping the team branch untouched. Lower priority
than FA — no task, approval or file content leaks through these — but they are
the last two ungated client-reachable SELECT policies in the matrix.

**FE — Cover the two structural properties no test asserts.** Nothing asserts
that the Pages distribution counts sum to the rendered table's row count (the
count loop at `pages/page.tsx:64-66` and `PagesTable`'s rows are only ever
exercised separately, so a filter added to one and not the other ships green),
and nothing asserts the single-bucket-map property structurally — a reintroduced
local copy with identical strings passes everything until it drifts, which is
exactly how `status-manager.tsx`'s copy drifted unnoticed before F006g. Both are
cheap; neither blocks M1.

**Minor, no feature needed:** the comment at `status-label.ts:60-64` claims the
Overview's "Waiting on you" list and the Pages distribution's "Waiting on you"
count "agree by construction: both route every row through this same function."
That is true of the workspace-level `getPortalOverview` (`portal.ts:1131`) but
false of `getPortalWaitingOnYou` (`portal.ts:563-575`) and
`waitingOnYouPredicate` (`portal-overview-live.tsx:91-94`), which are
`pending_client_approval`-only and never read `client_bucket`. A PM who sets a
status's `client_bucket = 'waiting'` without an approval gets "Waiting on you: 1"
on Pages and "Nothing waiting on you" on Overview. Either unify the two or
correct the comment. Relatedly,
`tests/integration/f005-portal-pages.test.ts:484` is named for the agreement
AS-015 needs but compares against `getPortalOverview`, not the function that
renders the adjacent screen; swap in `getPortalWaitingOnYou` and it fails today.

---

## Toolchain output

### Typecheck — `npx tsc --noEmit`

```
components/approvals/request-approval-dialog.tsx(184,9): error TS2322: Type 'string | number | bigint | boolean | Element | Iterable<ReactNode> | Promise<AwaitedReactNode>' is not assignable to type 'ReactElement<unknown, string | JSXElementConstructor<any>> | ComponentRenderFn<HTMLProps, DialogTriggerState> | undefined'.
  Type 'string' is not assignable to type 'ReactElement<unknown, string | JSXElementConstructor<any>> | ComponentRenderFn<HTMLProps, DialogTriggerState> | undefined'.
```

**Out of M1 scope.** `components/approvals/` is untracked (`git status --porcelain
components/approvals/` → `?? components/approvals/`) — it is the concurrent
worker's in-flight M2 work, not committed M1 code. Every committed file
typechecks clean.

### Lint — `npx eslint`

```
✖ 20 problems (0 errors, 20 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

All 20 are `@typescript-eslint/no-unused-vars` on deliberately underscore-prefixed
mock parameters in pre-existing test files. Zero errors.

### Tests — unit suite only

The full suite was deliberately not run: another worker is active in this repo and
a full run manufactures Supabase auth rate-limit failures. Integration tests were
therefore not executed; every finding above is derived from reading the code, the
migrations and the test sources.

```
$ npx vitest run tests/unit
 Test Files  213 passed (213)
      Tests  1660 passed (1660)
   Duration  39.99s
```

```
$ npx vitest run components/portal tests/unit/portal-phases-query.test.ts \
    tests/unit/portal-overview-queries.test.ts tests/unit/portal-overview-live.test.tsx
 Test Files  18 passed (18)
      Tests  146 passed (146)
   Duration  2.60s
```

Green, and — for AS-011, AS-015 and AS-017 — meaningfully green. For AS-002 the
green is not evidence, for the reasons given above. For AS-007's four holes there
is no test at all.
