# M2 Scrutiny — Approvals (F007–F011)

Mission: 20260903-portal · Milestone M2 · Reviewed at `8c7c9d5`
Read-only. No code, test, migration or contract file was modified.

---

## VERDICT

**M2 does not pass.** One blocker, four majors.

The core of this milestone is genuinely good. `decide_approval_atomic` is now
correct as a whole: F006l's `portal_enabled` gate and F007's decision-owner
check both fire on every path including F011's new `changes_requested` branch,
there is no `EXCEPTION` block anywhere in the function, and the AS-024
immutability trigger guards *all* columns rather than just `state`. F011's
atomicity claim is true. AS-002's badge, which failed M1 three times, is now
correct in code. Typecheck is clean, lint has zero errors, no hex literal
appears anywhere in the M2 diff.

What M1 taught us still applies, and it landed twice:

- **A path that never reaches the gate.** F009's plan said it "reuses and
  replaces the existing `approval-actions.tsx` path". It did not replace it.
  The old client-facing approve button is still live on the portal task page
  and calls an RPC with **no decision-owner check at all**. AS-022 is enforced
  perfectly on the surface everyone reviewed and not at all on the one nobody
  did.
- **A test that mirrors the implementation.** AS-002's fix is real; the test
  written to prove it discards the exact `.eq()` that makes it true, and its
  own comment claims otherwise. This is the same defect M1 round 3 named on
  the same file, moved one query to the left.

And one new, self-inflicted break: F011's new FK column interacts with F007's
immutability trigger to make a task permanently un-purgeable.

---

## Assertion table

| ID | Verdict | Severity | Reason |
|---|---|---|---|
| AS-002 | **FAIL** | major | Predicate is now correct (`lib/queries/portal.ts:539-567`) but the `project_decision_owners` mock discards both `.eq()` args (`tests/unit/portal-overview-queries.test.ts:82-93`); deleting `.eq("user_id", user.id)` ships green. |
| AS-019 | PASS | — | Task/doc/artifact paths all exist and are integration-tested (`lib/actions/approvals.ts:221,245,258`). |
| AS-020 | PASS | — | Enforced in RLS (`20260916010000:205-222`) and in the app path (`approvals.ts:222-243`); test asserts errcode `42501`. |
| AS-021 | **FAIL** | major | A `doc`-subject approval renders no way to see what is being approved (`approval-card.tsx:56-67` → `href = null`), and the snapshot F008 uploads is read by nothing. The "due date" clause is asserted by no test. |
| AS-022 | **FAIL** | major | `decide_approval_atomic` is correct, but a second, ungated client decision path is still live (`approval-actions.tsx` → `approve_portal_task_atomic`, no owner check). |
| AS-023 | PASS | — | Genuinely tested end-to-end (`f009-decide-approval-action.test.ts:207-234`) re-reading `decided_by`/`decided_at`/`state`/flag via the admin client. |
| AS-024 | **FAIL** | blocker | F011's `resulting_task_id … on delete set null` fires the settled-row trigger; `purge_task` on that task raises `42501` and fails permanently. Also: DELETE immutability rests on policy *absence* only. |
| AS-025 | PASS | — | Note required (`:134-136`), task created carrying it (`:212-219`), comment posted (`:226-227`), all before the settle UPDATE. No `EXCEPTION` block — rollback is real. |
| AS-026 | PASS | — | `getApprovalHistory` scoped `.eq("project_id").neq("state","pending")`; renders request title, never the subject task's title. |
| AS-027 | PASS | major follow-ups | RLS-scoped session client, `.eq("state","pending")`, `order("requested_at", asc)` in SQL, no `.limit()`. See F-3/F-4 below. |

---

## Findings, ranked

### B1 — blocker — a settled `changes_requested` decision makes its own task un-purgeable

`supabase/migrations/20260923010000_f011_changes_requested_creates_task.sql:80`
adds `resulting_task_id uuid references tasks (id) on delete set null`. That
column is only ever written in the same UPDATE that sets
`state = 'changes_requested'` (`:231-237`), so any row holding it is settled.

`prevent_approval_request_settled_update`
(`20260916010000_approval_requests.sql:95-114`) is a `BEFORE UPDATE … FOR EACH
ROW` trigger that raises `42501` whenever `OLD.state <> 'pending'`, for every
role including `service_role`. **A referential `ON DELETE SET NULL` is a real
UPDATE and fires row triggers.**

**State that triggers it.** Client requests changes → task T created → team
soft-deletes T → team empties the trash. `purge_task`
(`20260822220000_purge_task_and_comment.sql:114`) issues `delete from tasks`;
Postgres attempts the SET NULL on the settled approval; the trigger raises;
the whole purge aborts. `lib/actions/purge.ts:166` logs it and returns
`"Something went wrong."` The task can never be purged, and the user is never
told why.

The migration's own header (`:11-16`) asserts this cannot happen — "fires on
`OLD.state`, not this column". That is true for direct writes and false for
the SET NULL path the same migration created. No test covers it; the F011
suite's own `afterAll` (`f011-decide-approval-creates-task.test.ts:164`) hits
this and swallows the error, so it leaks fixture rows rather than failing.

Same mechanism, currently unreachable but latent: `phase_id … on delete set
null` (`20260916010000:33`) versus `deletePhase`'s hard DELETE
(`lib/actions/phases.ts:399`). Unreachable today only because nothing in the
app ever sets `approval_requests.phase_id` — `grep phase_id lib/actions/approvals.ts`
returns nothing, which also means F011's generated task always lands with
`phase_id = null`.

### B2 — major — AS-022 has a second client decision path with no owner check

`app/(portal)/portal/[workspaceSlug]/p/[projectId]/t/[taskId]/page.tsx:80-82`
still renders `<PortalApprovalActions>` whenever `task.pendingClientApproval`.
That component calls `approve_portal_task_atomic` /
`request_portal_task_changes_atomic`
(`20260906010000_portal_task_actions_project_visibility.sql:99-145`), whose
only gate is `assert_portal_task_actionable_by_client` — active client member,
`client_visible`, pending flag, project visible, portal enabled. **No
`project_decision_owners` lookup.**

`plan.md` F009 says the view "Reuses and **replaces** the existing
`approval-actions.tsx` path." `approval-card.tsx:6` acknowledges it
"supersedes" it. Neither happened: both files are live, both are wired, and
they disagree about who may decide.

**State that triggers it.** Two client contacts; `project_decision_owners`
maps `brand` → Anna. The team sets `pending_client_approval` on a task. Bob
(client, owns nothing) opens `/portal/<ws>/p/<id>/t/<task>` and clicks
Approve. It succeeds. On the Approvals view the same Bob is correctly refused
with `42501`.

Secondary: `project_decision_owners_update_team`
(`20260916010000:294-299`) has `WITH CHECK` of only
`is_project_workspace_writer(project_id)` — any project writer can re-point
any decision type at any `auth.users` id, with no check that the new owner is
even a member of the project or workspace. AS-022's "named decision owner" is
only as strong as the writer set.

### B3 — major — AS-002's fix is right and its test cannot see it

`lib/queries/portal.ts:539-543` resolves the caller's own decision types
before counting — the M1 finding is genuinely fixed, and the
`approval_requests` half of the mock was correctly migrated to
`applyFilters`/`eqFilter`/`inFilter`
(`tests/unit/portal-overview-queries.test.ts:56-80`).

The `project_decision_owners` half was not
(`tests/unit/portal-overview-queries.test.ts:82-93`):

```ts
select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(async () => ({ data: ownerRows, ... })) })) }))
```

Both `.eq()` arguments are discarded. `test_AS_002_another_clients_owned_
decision_type_is_not_counted` (`:279-291`) changes `currentUserId` and then
*hand-sets* `ownerRows = []`; its comment claims it "proves the owner lookup
is scoped by `user_id`". It proves nothing. Delete `.eq("user_id", user.id)`
from `portal.ts:543`, or swap it for `.eq("project_id", projectId)` twice, and
every test in the block stays green. This is M1 round 3's finding on the same
file, relocated by one query.

### B4 — major — AS-021: a doc-subject approval shows the client nothing to look at

`components/portal/approval-card.tsx:56-67` returns a link only for
`subjectType === "task"` (internal task route) or when `artifactUrl` is set.
A `doc` subject has neither, so `href` is `null` and no "Open" control renders
(`:189`). The client is asked to approve a document by title alone.

F008 does upload a doc-body snapshot (`lib/actions/approvals.ts:169-184`,
`artifact_snapshot_path`) — into the `task-attachments` bucket under
`approval-requests/{id}/…`, a path no storage policy matches. `grep
artifact_snapshot_path` across `lib/queries/approvals.ts`,
`lib/actions/portal-approval.ts`, `components/portal/` and the approvals route
returns **zero** read sites. It is a write-only object.

Also on AS-021: `test_AS_021_getOpenApprovalsForClient_returns_the_open_card_
with_what_and_due_date` (`f009-decide-approval-action.test.ts:278-289`) never
sets `due_at` (its `insertPendingRequest` helper at `:99-112` omits it) and
never asserts `dueAt`. The due-date clause is unverified by the test named for
it.

Related, same root cause: `approval_requests_select_client`
(`20260916010000:184-193`) applies its subject-visibility check **only** for
`subject_type = 'task'`. Combined with `docs_select_active_members`
(`20260904010000_docs_system.sql:119-124`), which is
`is_active_workspace_member(workspace_id)` with no client carve-out, a
doc-subject approval is a supported way to put an internal doc's title in
front of a client.

### F-1 — major — unvalidated `subject_id` is a cross-project write primitive

`decide_approval_atomic` reads `task_type_id` from `v_subject_id` (`:203`),
inserts a comment on it (`:226-227`) and clears its
`pending_client_approval` (`:241-243`) — **none of which filter by
`v_project_id`**. The only project comparison, at `:245-248`, exists purely to
decide whether to pass a task id to `create_notification`; the code therefore
already knows the mismatch is possible and defends only the notification.

Nothing in the schema validates `subject_id`: no FK (`20260916010000:40`
says so explicitly), no CHECK beyond null-ness (`:69-72`), no trigger. The
INSERT policy's `EXISTS` on `tasks` (`:213-221`) checks `client_visible` and
`deleted_at` but **not** `t.project_id = approval_requests.project_id`. The
only such check is TypeScript: `lib/actions/approvals.ts:228-230`.

A team writer posting directly to PostgREST can therefore create an approval
on project A whose subject is a client-visible task in project B. When A's
client decision owner decides, a comment authored by that client is inserted
onto B's task and B's flag is cleared. Privileged setup, so major rather than
blocker — but it is exactly the shape M1 warned about, and no test covers it.

### F-2 — major — `requestApproval` has no `portal_enabled` gate

`loadProjectExtra` (`lib/actions/approvals.ts:102-119`) selects `id,
workspace_id, visibility, deleted_at`. The client SELECT policy requires
`is_project_portal_enabled` (`20260916010000:183`). So on a portal-off project
the team can raise approvals successfully and the client can never see one.
The action already refuses to raise an approval with no decision owner
(`:199-215`) for precisely this "sent into a void" reason — enforced for one
cause and not the other.

### F-3 — major — the approvals queue has no guest guard, and its own comment says it does

`app/(workspace)/w/[workspaceSlug]/approvals/page.tsx` has no `role ===
"guest"` redirect. `components/nav/app-sidebar.tsx` states Approvals is "gated
to non-guests the same way Members/Archive already are", and
`app/(workspace)/w/[workspaceSlug]/archive/page.tsx:78` really does redirect.
`is_project_visible_to`
(`20260908010000_pin_pg_temp_on_client_visibility_predicates.sql:44-66`) has an
unconditional `project_members` branch with no role restriction, so a guest
who is a project member and types the URL gets a working queue with requester
and decision-owner names. Not a data leak beyond RLS — and `withdrawApproval`
is safe, since `canWrite` excludes guest (`lib/auth/permissions.ts:106`) — but
the route's documented gate does not exist.

### F-4 — major — "what it blocks" surfaces trashed tasks and never checks the subject's project

`lib/queries/approvals.ts:283-286` — `.from("tasks").select("id, title,
phase_id").in("id", taskSubjectIds)` — has no `.is("deleted_at", null)`, while
`tasks_select_trash_visible_members`
(`20260902010000:175-184`) grants exactly this caller access to trashed rows.
The type comment at `:212-216` claims `blocks` is null when the subject "has
since been deleted"; that is false for soft deletes. Neither the tasks read
(`:283-286`) nor the docs read (`:318-320`) cross-checks the subject against
`row.project_id`, so a mismatched subject renders project B's task title under
project A's name.

### F-5 — major — the whole queue is recomputed on every workspace page render

`app/(workspace)/w/[workspaceSlug]/layout.tsx:242` calls
`getOpenApprovalsForWorkspace` inside the layout's `Promise.all`, and `:373`
uses only `openApprovals.length`. Every navigation to any `/w/<slug>/*` route
runs projects + approval_requests + `resolvePeople` (which per
`lib/queries/people.ts:14-19` falls back to one Auth Admin API call per
requester id) + tasks + phases + docs, and discards all of it. It runs
*before* the client-role redirect at `:263`, so client-role users pay for it
on every portal-bound render.

### F-6 — minor

- `components/portal/approval-card.tsx:204-210, 231` uses raw
  `emerald-600` / `amber-600`, with no dark-mode variant, twelve lines after
  the same file uses `bg-status-blocked-bg` / `text-status-waiting`
  correctly (`:172-174`), and while `approval-history.tsx:70-76` uses the
  tokens for the identical semantic states. Design constraint 3 says these are
  added once and "never re-pick[ed] per component". Two colour systems for one
  concept inside one feature.
- `components/approvals/request-approval-dialog.tsx:120-138` — `getDecisionOwners`
  swallows its error and returns `[]` (`lib/queries/approvals.ts:150-153`), so
  a transient DB failure renders the confident, wrong message "No one is set
  up to approve … Set an owner in project settings first." The
  `hasOwnerLoadFailed` branch at `:301-305` is dead code.
- `approvals-queue.tsx:62` builds a `?approvalId=` deep link that the portal
  approvals page does not read — the escalation mechanism lands the client on
  an unfiltered list.
- `subject_type = 'phase'` renders "—" in the queue's blocks column
  (`lib/queries/approvals.ts:331-346`).
- `lib/actions/portal-approval.ts:169-186` still writes the comment before the
  RPC. Authorisation is not bypassed (`:35-93` gate first), but a caller who
  passes the client/pending gate and fails the RPC leaves an orphan
  "Requested changes:" comment.
- Every M2 integration suite is `describe.skipIf(!haveCreds)`; without `.env`
  a local run reports green with zero coverage of AS-019–AS-027.

### Not defects — checked and clear

- `decide_approval_atomic` has no `EXCEPTION` block on any path; F011's task
  and comment inserts genuinely roll the whole function back. (The forced-
  failure test at `f011:251-303` proves only that PL/pgSQL rolls back on
  exception, not the ordering its header claims — but the behaviour is right.)
- Both gates fire on the `changes_requested` branch: `portal_enabled` at
  `:162-164`, decision owner at `:167-174`, both *above* the new block at
  `:179`.
- `decideApproval` uses the RLS session client, so `auth.uid()` is real
  (`lib/actions/portal-approval.ts:314-333`).
- The settled-row trigger guards all columns for all roles including
  `service_role`; a team writer cannot settle a row via the UPDATE policy
  (`WITH CHECK … state='pending' and decided_by is null`).
- Artifact URLs are scheme-restricted to `http(s)` (`lib/validation/approvals.ts:54-62`)
  and rendered with `rel="noopener noreferrer"`.
- No hex literal anywhere in the M2 diff; no `'use client'` component queries
  Supabase directly; `components/ui/*` reused throughout.
- AS-027's ordering is `requested_at` ascending in SQL with no `.limit()`, and
  the client component does not re-sort.

---

## Recommended follow-up features

**FG — Break the settled-row trigger's collision with the FK referential
updates.** `resulting_task_id … on delete set null` and `phase_id … on delete
set null` both perform genuine UPDATEs on `approval_requests`, which the
`prevent_approval_request_settled_update` trigger rejects for any settled row,
aborting the parent delete. Purging a task created by a `changes_requested`
decision fails today. Fix by narrowing the trigger so the referential
nulling is permitted while every business column stays frozen — e.g. raise
only when a column other than `resulting_task_id`/`phase_id` is `distinct
from` its old value, or drop the FK actions in favour of `on delete no
action` plus explicit cleanup inside `purge_task` and `deletePhase`. While
there, close AS-024's DELETE half: it is currently enforced only by the
absence of a policy, so the service-role client and the `projects` cascade
both erase settled history — add a `BEFORE DELETE` trigger mirroring the
UPDATE one. Definition of done: a test that settles a `changes_requested`
decision, soft-deletes the resulting task, purges it, and asserts the purge
succeeds and the approval row survives with `resulting_task_id` null; plus a
test that a direct service-role DELETE of a settled row is rejected.

**FH — Retire the second client approval path.** `approval-actions.tsx` and
`approve_portal_task_atomic` / `request_portal_task_changes_atomic` let any
client member of the project clear `pending_client_approval` with no
decision-owner check, which is the outcome AS-022 says only the named owner
may reach. F009's plan entry already required this replacement. Either delete
the component and the two RPCs and have the portal task page link to the
Approvals view, or add the `project_decision_owners` lookup to
`assert_portal_task_actionable_by_client`'s callers so both paths enforce the
same rule. Decide at the same time whether raising an approval against a task
should set `tasks.pending_client_approval = true` — today `requestApproval`
never sets it, so AS-023's "clears the linked task's pending-approval flag"
clause is vacuous for the new flow while the old flag continues to drive a
separate UI. Add a `WITH CHECK` to `project_decision_owners_update_team`
requiring the new `user_id` to be an active member of the project's workspace.
Definition of done: a test where a non-owner client is refused on *both*
surfaces, and a test that the two surfaces agree on whether a request is open.

**FI — Give AS-002's test the ability to fail, and gate creation on
portal_enabled.** Migrate the `project_decision_owners` branch of the mock at
`tests/unit/portal-overview-queries.test.ts:82-93` onto the existing
`applyFilters`/`eqFilter` helper, and rewrite
`test_AS_002_another_clients_owned_decision_type_is_not_counted` so it seeds
`ownerRows` for *both* clients and relies on the query's own `user_id` filter
to exclude the other one, rather than hand-setting `[]`. Add an integration
case with two client contacts and per-type owners asserting each sees only
their own count. Separately, add `portal_enabled` to `loadProjectExtra`
(`lib/actions/approvals.ts:102-119`) and refuse to raise an approval on a
portal-off project, for the same reason the action already refuses when no
decision owner exists.

**FJ — Make a doc-subject approval viewable, or stop offering it.** F008
uploads a doc-body snapshot to a storage path no policy matches and nothing
reads; F009 renders no link for a doc subject, so the client approves a title.
Either give the portal a read path (a signed URL minted server-side after the
same membership + `portal_enabled` + project-visibility checks
`getAttachmentSignedUrl` now performs), or render the snapshot inline and drop
the storage round trip. In the same pass, extend
`approval_requests_select_client` (`20260916010000:184-193`) so `doc` subjects
carry a visibility prerequisite rather than being exposed unconditionally, and
add the missing `due_at` to the AS-021 fixture so the test named for the due
date actually asserts it.

**FK — Constrain `subject_id` to its own project, in the database.** Add
`t.project_id = approval_requests.project_id` to the `EXISTS` clauses in both
`approval_requests_insert_team` and `approval_requests_select_client`, and add
the same predicate to `decide_approval_atomic` before it touches
`v_subject_id` at `:203`, `:226-227` and `:241-243` — raise rather than
silently skip, since a mismatched subject means the row is malformed. This
removes the cross-project comment/flag write primitive and makes the check at
`:245-248` redundant rather than load-bearing.

**FL — Harden the approvals queue.** Add the `role === "guest"` redirect that
`app-sidebar.tsx` already claims exists, matching `archive/page.tsx:78`. Add
`.is("deleted_at", null)` to the blocks lookup at
`lib/queries/approvals.ts:283-286` and cross-check both the tasks and docs
subject reads against `row.project_id`. Replace the layout's full
`getOpenApprovalsForWorkspace` call (`layout.tsx:242`) with a head count, and
move it below the client-role redirect at `:263`. Give
`components/approvals/approvals-queue.tsx` its first render test — the summary
strip, past-due chip, withdraw and empty state are all currently untested, and
extend the integration fixture with a trashed subject task, a doc subject, a
guest session and a third project so the ordering and completeness assertions
mean something.

---

## Toolchain output

### Typecheck — `npx tsc --noEmit`

```
(no output — clean)
```

The `request-approval-dialog.tsx` error M1 round 3 saw in untracked work is
gone; the committed M2 tree typechecks clean.

### Lint — `npx eslint .`

```
✖ 20 problems (0 errors, 20 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

All 20 are `@typescript-eslint/no-unused-vars` on deliberately
underscore-prefixed mock parameters in pre-existing test files. Zero errors,
none in M2 files.

### Tests — targeted only

The full suite was deliberately not run (it manufactures Supabase auth
rate-limit failures). Every finding above is derived from reading the
migrations, the code and the test sources; the runs below were used only to
confirm the M2 unit/component layer is green.

```
$ npx vitest run components/portal/approval-card.test.tsx \
    tests/unit/portal-overview-queries.test.ts \
    tests/unit/portal-overview-live.test.tsx
 Test Files  3 passed (3)
      Tests  47 passed (47)
   Duration  881ms
```

Green — and for AS-023, AS-025 and AS-026 meaningfully green. For AS-002 the
green is not evidence, for the reason given in B3. For B1, B2, B4, F-1, F-2,
F-3 and F-4 there is no test at all.
