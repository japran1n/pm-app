# M3 Scrutiny — Your list, scope, decisions (F012–F016)

Mission: 20260903-portal · Milestone M3 · Reviewed at `5736170`
Read-only. No code, test, migration or contract file was modified.

---

## VERDICT

**M3 does not pass.** One blocker, four majors.

The security core of this milestone is the best work in the mission so far, and
I am not going to manufacture objections to it. The four new tables copy
`tasks_select_client` faithfully — every client SELECT policy carries
`is_project_client` + `is_project_visible_to` + `is_project_portal_enabled`, and
AS-045's `client_visible` conjunct lives **in the policy**, not in a `.eq()`, so
aggregates and counts are structurally safe and a forgotten call site cannot
leak. None of the four tables has a client INSERT/UPDATE/DELETE policy at all.
The three new client-callable RPCs all pin `search_path = public, pg_temp`.
`mark_deliverable_delivered_atomic` takes no state parameter — there is no
argument a client could pass to reach `accepted`, and I found no path to
`accepted` through the RPC, PostgREST, or any server action.
`accept_client_request_atomic` survived its second modification intact: F006n's
authorisation preamble still fires above every F016 branch, and the gate refuses
a quote that expired between approval and acceptance. Typecheck is clean, lint
has zero errors, and there is not one hex literal, `px` radius or inline font
stack in the entire M3 component diff.

What the earlier gates taught landed once more, in its purest form:

- **A gate applied in one query and forgotten in another.** `project_assumptions`'
  client SELECT policy requires `client_visible`. `flag_assumption_atomic`, the
  SECURITY DEFINER RPC that is the *only* client write path to that table,
  checks client-ness, visibility and portal-enabled — and not `client_visible`.
- **A column added to a table whose write policy nobody re-read.** F016 added
  fifteen columns to `client_requests` and zero policy changes. The pre-existing
  author-UPDATE policy pins five columns and lets the client write the other ten,
  including `quoted_amount` and `client_decision`.
- **A test whose fixture cannot express the condition it claims.** F013's
  manual-unblock test performs the unblock and then asserts the row it just
  wrote, never re-running the sweep. A re-run flips it back and the test still
  passes.

And one genuinely new break, which two independent reviewers reached separately:
an unvalidated `task_id` written through the service-role client is now both a
cross-workspace **read** leak into the portal and a cross-workspace **write**
executed hourly by cron.

---

## Assertion table

| ID | Verdict | Severity | Reason |
|---|---|---|---|
| AS-003 | **FAIL** | major | Badge adds `.eq("blocking", true)` (`lib/queries/deliverables.ts:115`); the assertion has no blocking qualifier, and the view it links to classifies past-due differently (`your-list/page.tsx:37-41`). |
| AS-028 | PASS | — | All five columns with CHECK vocabularies (`20260926010000:41-67`); full CRUD, reorder, template seeding, round-tripped in integration. |
| AS-029 | PASS | minor | Sections split correctly on accepted/waived (`your-list/page.tsx:102-113`); the aggregate header mislabels accepted as "delivered" (`:114,121`). |
| AS-030 | PASS | — | `delivered` excluded only from the settled section; counted as outstanding in the list, the `progress` segment and the badge. No client path to `accepted` exists. |
| AS-031 | PASS | — | `getWorstOverdueBlockingDeliverableRisk` shares the badge's exact filter and sits downstream of `getPortalProjects`' `portal_enabled` filter (`lib/queries/portal.ts:133`). |
| AS-032 | PASS | — | Note requirement enforced in the DB (`20260927010000:76-78`, errcode `22023`), not only the UI; client sees "Sent back: <note>"; accepted branch nulls `review_note`. |
| AS-043 | PASS | — | `included boolean not null` + two-value `source` CHECK (`20260926010000:97-113`); both render paths present. |
| AS-044 | PASS | major follow-up | Table is right and `created_by = auth.uid()` is pinned in the INSERT policy. See F-3: the comment-derived path hardcodes `client_visible: true` and trusts browser-supplied text. |
| AS-045 | PASS | — | `client_visible` leads the RLS policy itself (`:296-305`), so direct selects, lists and counts are all covered; test at `f012…rls.test.ts:472-495` fails if the predicate is removed. |
| AS-046 | **FAIL** | major | `flag_assumption_atomic` never checks `client_visible` (`20260929010000:51-71`) — the one gate the SELECT policy applies. |
| AS-047 | PASS | — | Gate is inside the function (`20260930010000:352-366`), below the auth preamble, null-safe via `is distinct from`, and refuses an expired quote. No client-reachable bypass found. |
| AS-048 | **FAIL** | major | Client SELECT on `client_requests` is `created_by = auth.uid()` (`20260913010000:30-34`). With two client contacts, client B's Scope view shows *none* of client A's change requests; the assertion says "each". |

---

## Findings, ranked

### B1 — blocker — `client_deliverables.task_id` is a cross-workspace read leak and an hourly cross-workspace write

`client_deliverables.task_id` is `references tasks (id)` and nothing more
(`20260926010000:44`). There is no same-project CHECK, no trigger, and no
validation in either write path: `lib/actions/deliverables.ts:225` (create) and
`:294` (update) pass `input.taskId` straight into an insert/update issued through
**`ctx.admin`** — the service-role client, so RLS never evaluates. `withAuthz`
resolves authorisation from the *deliverable's* project only; the task id is
never compared to `ctx.projectId`. The Zod schema is `z.string().uuid()`
(`lib/validation/deliverables.ts:56,70`). The UI picker only *offers*
same-project tasks — that is presentation, not enforcement, and a Server Action
is directly callable.

Two consequences, both real:

**Write.** `sweep_overdue_blocking_deliverables`
(`20260927010000:213-231`) joins `join tasks t on t.id = cd.task_id` with **no
`t.project_id = cd.project_id`**, while resolving the blocked status from
`ps.project_id = cd.project_id` (`:219`). Every hour, cron sets the foreign
task's `status_id` to a `project_statuses` row belonging to a different project
— and `tasks.status_id` has no project-consistency constraint either
(`20260824010000:102`), so the target project's board renders against a column
it does not own. The `p.deleted_at is null` guard at `:229` checks the
*deliverable's* project, never the task's, so the victim project can even be
soft-deleted.

**Read.** `resolveHoldsUpContext` (`lib/queries/deliverables.ts:164-199`) reads
`tasks` and `project_phases` through `createAdminClient()` and scopes by
`.in("id", taskIds)` with **no `project_id`**. A client-visible task title or
`page_slug` from another project — in another workspace — renders as the "holds
up" label on a deliverable row in this project's portal. The function's own doc
comment (`:145-151`) asserts this cannot happen.

**State that triggers it.** A non-viewer, non-client member of workspace A with
visibility on project P1 calls `updateDeliverable({ deliverableId: <P1 row>,
taskId: <task in P2 of workspace B>, blocking: true, dueAt: <past> })`. The
label leaks on the next portal render; the status write lands on the next cron
tick. No test covers a cross-project `task_id` anywhere.

The fix needs both halves: `and t.project_id = cd.project_id` in the sweep and
in `resolveHoldsUpContext`, **and** a same-project check on `task_id`/`phase_id`
at the write, since the malformed row is also visible to every other reader.

### B2 — major — AS-046: `flag_assumption_atomic` forgot the one gate the policy applies

`supabase/migrations/20260929010000_f015_flag_assumption_atomic.sql:51-71` selects
`pa.project_id, pa.text, pa.state` — it never reads `client_visible` — and gates
on `is_project_client`, `is_project_visible_to`, `is_project_portal_enabled`.
`project_assumptions_select_client` (`20260926010000:355-364`) leads with
`client_visible`. The RPC is SECURITY DEFINER, so RLS does not backstop it.

**State that triggers it.** A client POSTs
`flag_assumption_atomic(<uuid of a client_visible = false assumption in their own
project>, 'note')`. It succeeds: `flagged_by_client_at` and `flagged_note` are
stamped on a row the client cannot read, and an `assumption_flagged` notification
carrying the assumption's `text` fires to every non-viewer, non-client member.
The success/`P0002` split is also an existence oracle over assumption ids.

UUID guessing makes this weak to exploit; the missing conjunct is the defect, and
it is exactly the shape M1 round 3 and M2 both named. Everything else about this
function is right — it does not touch `state`, directly or by side effect (the
only trigger on the table is `set_updated_at`, whose body is two lines), and its
cross-project and portal gates hold.

### B3 — major — F016 added fifteen columns and re-read no write policy

`client_requests_update_author_while_submitted` (`20260918010000:111-127`) has
`USING (created_by = auth.uid() and status = 'submitted' and
is_project_portal_enabled(project_id))` and a `WITH CHECK` pinning only
`converted_task_id is null and reviewed_by is null`. RLS is row-level; there are
no column GRANTs on `client_requests` in any migration, and no BEFORE UPDATE
column-guard trigger (the only trigger is `set_updated_at`). F016 contains **zero
`create policy` statements**.

**State that triggers it.** A client PATCHes their own `status='submitted'`
request via PostgREST, setting `scope_verdict`, `quoted_hours`, `quoted_amount`,
`quote_currency`, `quote_valid_until`, `client_decision`, `decided_by`,
`decided_at`, `track`, `track_overridden` and `approval_request_id`. The team
inbox renders these as team-authored (`team-request-inbox.tsx:144-158`), so the
triaging PM is shown a fabricated "$0 — client approved" quote.

AS-047 itself still holds, and I want to be precise about why: the gate only
engages once a team member sets `scope_verdict = 'change_request'` through
`send_change_request_quote_atomic`, and that RPC resets `client_decision =
'pending'` and moves `status` `submitted → in_review` (`20260930010000:172-174`),
after which the author policy's `USING` no longer matches. A concurrent client
PATCH loses to the RPC's `for update of cr`. So this is integrity and deception,
not privilege escalation — but the column reach is unintended and undocumented.

### B4 — major — AS-003's badge and its own view disagree, on two axes

`getOverdueBlockingDeliverableCount` (`lib/queries/deliverables.ts:105-119`) adds
`.eq("blocking", true)`. AS-003's text is "the number of the client's
deliverables that are past their due date" — no blocking qualifier. The view the
badge links to classifies past-due with no reference to `blocking` at all
(`your-list/page.tsx:37-41`).

**State that triggers it.** One overdue `blocking = false` deliverable: the Your
list view shows a red "Was due …" row and a `blocked` segment of 1; the sidebar
badge shows nothing.

Second axis, same divergence: the badge counts overdue `delivered` rows (it
excludes only `accepted,waived`), while `classifyBucket` routes `delivered` to
`progress`. Both paths are individually unit-tested against their own
implementations, so neither test can see the disagreement. This is the M2 defect
shape — two code paths that must agree and do not — with the added twist that the
badge also disagrees with the contract.

### B5 — major — re-quoting duplicates scope items and strands a live approval

`client_requests_sync_decision_from_approval` (`20260930010000:222-278`) cannot
fire twice for one approval: `if OLD.state = NEW.state then return NEW` (`:235`)
plus `prevent_approval_request_settled_update` means one approval leaves
`pending` exactly once. But there is no idempotency guard for one *request*, and
`project_scope_items.change_request_id` has only a plain index, no unique
constraint (`20260926010000:98,109`); the insert at `:262-267` has no
`on conflict` and no `not exists`.

**State that triggers it.** Team quotes request R at $1200 → approval A1. Client
approves → scope item S1. Team re-quotes R at $1500 (permitted —
`send_change_request_quote_atomic:139` only blocks `status='accepted'`) → approval
A2, `approval_request_id = A2`, `client_decision` reset to pending. Client
approves A2 → **S2**, same `change_request_id`. The Scope list now shows the
change twice, and S1 permanently describes the withdrawn $1200 quote with no
cleanup path.

The same re-quote leaves A1 **pending and still rendered on the client's
Approvals view**. If the client approves A1 instead, the trigger's
`cr.approval_request_id = NEW.id` guard (`:243-246`) no longer matches, and it
returns early: no sync, no scope item, no error, no feedback. The client has
approved a price that is no longer recorded anywhere. That is a silent failure on
the mission's headline new flow.

Not defects, checked: a client cannot drive this trigger — `approval_requests` has
no client INSERT/UPDATE policy, and `decide_approval_atomic` enforces AS-022's
decision-owner check. A settled approval cannot be withdrawn, so
withdraw-after-approve cannot orphan a scope item. The trigger pins
`search_path = public, pg_temp`.

### F-1 — major — the sweep fights a human every hour, and its test cannot see it

The sweep satisfies both of its stated rules on the narrow reading: the only
`update tasks` (`20260927010000:233-236`) can write nothing but the resolved
blocked status, and `t.status_id is distinct from ps_blocked.id` (`:230`) makes a
second run a no-op. `distinct on (t.id)` (`:206`) caps it at one update and one
activity row per task per run even with two overdue deliverables on one task.

But if a team member moves the task out of Blocked while the deliverable is still
overdue and unaccepted, the next hourly run re-blocks it and writes another
`task_activity` row — every hour, indefinitely. The migration header (`:167-172`)
says "a human decides when something is unblocked". Nothing records that a human
already overrode it.

`tests/integration/f013-deliverables-review-and-sweep.test.ts:347-374` is named
for this case. It performs the manual unblock and then asserts the row it just
wrote — it never re-runs the sweep. A re-run flips the row back and the test
still passes. The assertion is vacuous.

Sub-case: with two `client_bucket = 'blocked'` columns, a human moving the task
to the second one has it yanked back to the lowest-`position` one.

### F-2 — major — F014's upload writes storage before the authoritative gate, and never rolls it back

`lib/actions/portal-deliverables.ts` uploads the object (`:218`) and inserts the
`attachments` row (`:230`) before calling `mark_deliverable_delivered_atomic`
(`:252`). The RPC is the real boundary — the action says so at `:246-250` — and on
`rpcError` the action returns `GENERIC_ERROR` (`:262`) with **no storage or
attachment cleanup**, though the same file does clean up correctly when the
attachment insert fails (`:242`).

Compounding it, the action's three pre-checks (`:152`, `:157`, `:162`) are
resolved from **`taskRow.project_id`** — the linked task's project — while the RPC
authorises against `cd.project_id`. On a cross-project link (B1) the two halves of
one operation authorise against different projects: the client's file lands on
project B's task and is visible to B's team, and only then does the RPC refuse the
state flip for project A.

Path construction itself is sound — `${taskRow.id}/${uniqueSuffix}-${safeName}`
with a server-derived task id, a sanitising regex and `upsert: false`, size and
MIME re-validated against the real byte length. Storage RLS is irrelevant because
the write goes through the service-role client.

### F-3 — major — "Turn into decision" publishes an internal comment to the portal and trusts the browser for its content

`lib/actions/project-records.ts:668-680` hardcodes `client_visible: true`, with no
dialog and no warning (`components/task/comment-list.tsx:578-599`). A team member
clicking "Turn into decision" on a comment on a `client_visible = false` task puts
that comment's full text on the portal Scope page in one click — the outcome
AS-045 exists to prevent for hand-authored decisions.

Worse, `commentText`, `commentAuthorName` and `commentCreatedAt` all arrive from
the browser (`lib/validation/project-records.ts:110-119`), and `commentId` is used
only in audit metadata (`:711`) — never verified to exist or to belong to
`taskId`. A workspace writer can mint a client-visible "decision" attributed to
any name and date, with an audit trail pointing at an unrelated comment. Fetch the
comment server-side from `commentId` and derive all three.

### F-4 — minor

- **The custom SQLSTATEs are read by nothing.** `20260930010000:352-356` justifies
  `CR047`/`CR048` as existing "so the UI can tell this apart from a generic
  failure". `grep -rn "CR047\|CR048" lib components app` returns only the test
  file; `acceptClientRequest` collapses every `rpcError` to `GENERIC_ERROR`.
  CR047 is mostly unreachable through the UI (the button is disabled), so the one
  genuinely reachable code — CR048, expired quote — surfaces to the team as
  "Something went wrong."
- **A client can approve an already-expired quote.** `decide_approval_atomic` does
  not check `due_at`. The portal then renders "Approved" while
  `accept_client_request_atomic:363` refuses forever with CR048. The test at
  `f016…test.ts:229-263` encodes this dead end as expected rather than flagging it.
- **Existence oracle in the upload action.** `portal-deliverables.ts:107` and
  `:113` return distinguishing errors ("This item has already been accepted.",
  "This item has no linked task…") for an arbitrary UUID, before
  `requireActiveMembership` runs at `:152`. Any authenticated user of any
  workspace can probe deliverable ids for existence and accepted/waived state.
- **"X of Y delivered" counts accepted, not delivered.** `your-list/page.tsx:114`
  sets `deliveredCount = counts.done` (accepted/waived) and renders it at `:121`.
  A client who has just uploaded all five items reads "0 of 5 delivered"
  immediately after being told "Sent. We'll check it."
- **A test asserts the opposite of its own name.**
  `tests/unit/portal-overview-queries.test.ts:685` is
  `test_AS_031_never_surfaces_a_delivered_deliverable_…` and asserts at `:709-715`
  that the delivered row *is* surfaced.
- **Admin mocks that discard their filters.** In
  `tests/unit/portal-overview-queries.test.ts`, only the `client_deliverables`
  chains go through `applyFilters`; the `tasks` (`:260-265`) and `project_phases`
  (`:288-295`) admin mocks discard the id list and the `.eq("client_visible",
  true)` respectively, and every risk fixture sets `client_visible: true`. The
  header comment at `:197-200` claims all admin tables use the real filter shape.
  This is what leaves B1's read half untested.
- **`.not()` mock drops unknown operators.** `tests/unit/helpers/query-filter-mock.ts`
  silently ignores any operator other than `is`/`in`, so rewriting a source query
  to `.not("state","eq","accepted")` would lose the filter without failing.
  `notInFilter` (`:42`) also does not trim whitespace around CSV members.
- **Unchecked cleanup.** `f016…test.ts:145-160` issues nine deletes with no error
  checking and no `try/finally` — a throw in an early delete skips
  `auth.admin.deleteUser`. `f013…test.ts:171-183` ignores every delete's error.
  (`f012` and `f014` `afterAll` blocks await unguarded and are honest.)
- **`accept_deliverable_atomic` accepts from any state** — no check that the row is
  `delivered`; only the UI gates it (`deliverables-panel.tsx:212`).
  `mark_deliverable_delivered_atomic` likewise re-stamps an already-`delivered`
  row; only `deliverable-row.tsx:141-146` prevents it.
- **`ctx.admin` on four deliverable paths.** `lib/actions/deliverables.ts:220, 285,
  357, 440-447` bypass RLS; the file header at `:8-12` claims "RLS as the
  backstop". Equivalent today because `canWrite` and `is_project_workspace_writer`
  agree, but the comment overstates the defence and it is what lets B1 through.
- **Two unscoped ids and one leak, all low.** `createDecision`/`updateDecision`
  insert `phaseId` unvalidated (`project-records.ts:395, 492`);
  `confirmed_by_name` is set to a team member's **email** (`:857`) and shipped to
  the portal in the RSC payload (not yet rendered); `AssumptionList` does
  `useState(assumptions)` with no prop sync (`assumption-list.tsx:152`).
- **`send_change_request_quote_atomic` writes `artifact_url` directly**, defaulting
  to `'about:blank'` (`20260930010000:185`), bypassing the `http(s)` scheme
  restriction `lib/validation/approvals.ts:54-62` applies on every other path.
- **Dead branch.** `accept_client_request_atomic:341` re-checks
  `v_caller_role = 'client'` four lines after `:336` already raised for it.
- **`write_task_activity_entry`, the sweep's callee, is `set search_path = public`
  without `pg_temp`** (`20260823060000:46`). Outside M3's diff; the one unpinned
  link in this feature's call chain.

### Not defects — checked and clear

- All four new tables: client SELECT carries the full three-predicate pattern plus
  `client_visible` where the table has it; **no client INSERT, UPDATE or DELETE
  policy exists on any of them**. Verified against every migration, not just F012's.
- AS-045 is enforced in the policy, so counts and aggregates are safe by
  construction. Explicitly tested at `f012…rls.test.ts:479-495`.
- `flag_assumption_atomic` cannot change `state` — directly or by side effect. The
  only trigger on `project_assumptions` is `set_updated_at`; there is no rule, no
  status recompute, and no client UPDATE policy.
- No client path to `deliverable.state = 'accepted'` through the RPC, PostgREST or
  any server action. The RPC has no state parameter at all.
- `accept_client_request_atomic`'s F006n auth preamble fires above every F016
  branch; F016 added only `raise`, no early return. Expired-quote refusal (CR048)
  is stronger than AS-047 required.
- A settled approval cannot be withdrawn or re-decided, so the sync trigger cannot
  be replayed for one approval, and withdraw-after-approve cannot orphan.
- A client cannot drive the sync trigger: no client write policy on
  `approval_requests`, and `decide_approval_atomic` still enforces AS-022.
- The sweep is correctly granted to `postgres, service_role` only; `authenticated`
  cannot call it. A project with no `client_bucket = 'blocked'` column is a silent
  no-op via the inner lateral join — the right call.
- All three new client RPCs pin `search_path = public, pg_temp`, and every helper
  predicate they call is pinned identically.
- Every server action in `lib/actions/project-records.ts` (ten of them) and
  `lib/actions/deliverables.ts` (five) goes through `withAuthz` with
  `requireWrite` + `requireVisibility` and re-derives the project from the row.
  No action forgot the gate.
- Design constraints: zero hex literals, zero `px` radii, zero inline font stacks
  across the entire M3 component diff. `components/ui/*` reused throughout. No
  `'use client'` component queries Supabase directly.
- The `client_deliverables` unit-test mocks genuinely apply their filters —
  deleting `.eq("project_id", …)` or `.eq("blocking", true)` from the badge query
  fails `portal-overview-queries.test.ts:427`.

---

## Recommended follow-up features

**FM — Constrain `task_id` and `phase_id` to their own project, and teach the
sweep and the label resolver to check.** This is the blocker. Add
`and t.project_id = cd.project_id` to the sweep's join
(`20260927010000:214`) and a `project_id` filter to both admin reads in
`resolveHoldsUpContext` (`lib/queries/deliverables.ts:174, 192`). Independently,
validate `taskId` and `phaseId` against `ctx.projectId` in `createDeliverable`
(`lib/actions/deliverables.ts:225`) and `updateDeliverable` (`:294`) before the
admin write — or add a database trigger, which is stronger given four other code
paths write through the service-role client and the file header already
mistakenly believes RLS is backstopping them. While there, fix F-2's ordering:
either move the storage upload and `attachments` insert after a successful
`mark_deliverable_delivered_atomic`, or add the cleanup on `rpcError` that the
attachment-insert branch already has, and resolve the action's three pre-checks
from the *deliverable's* project rather than the linked task's. Definition of
done: a test that links a deliverable in project P1 to a task in project P2 of
another workspace, runs the sweep, and asserts P2's task is untouched; a test that
the same row produces no "holds up" label in P1's portal; a test that a rejected
RPC leaves no storage object and no attachment row.

**FN — Add the missing `client_visible` conjunct to `flag_assumption_atomic`, and
close the AS-048 visibility gap.** Select `pa.client_visible` alongside
`pa.project_id` in `20260929010000:51` and raise the same `P0002` "not found" when
it is false, so the RPC's gate set is exactly the SELECT policy's. Add the
cross-project integration case the current suite lacks — a client who is an active
workspace client but has no `project_members` row on the target project, which is
the only case that exercises the `is_project_visible_to` half. Separately, decide
what AS-048 means with two client contacts: today
`client_requests_select_client` is `created_by = auth.uid()`
(`20260913010000:30-34`), so client B's Scope view shows none of client A's change
requests, and the assertion says "each change request". Widen it to the project's
clients (matching how approvals and decisions are already scoped) or record why it
must stay per-author. Definition of done: a test that a client cannot flag a
`client_visible = false` assumption, and a two-client test asserting both see the
same change-request list.

**FO — Give `client_requests` a column guard, and make the quote lifecycle
single-valued.** Tighten `client_requests_update_author_while_submitted`
(`20260918010000:111-127`) so the fifteen F016 columns are pinned to their `OLD`
values — a `BEFORE UPDATE` trigger is the practical way, since RLS is row-level
and the policy cannot express it. Then fix the re-quote cycle: add a unique
constraint (or a `not exists` guard) on `project_scope_items.change_request_id`
for `source = 'change_request'`, and have `send_change_request_quote_atomic`
withdraw the previous `approval_request_id` when it issues a new one, so the
client is never shown two live quotes for one request and can never approve a
stale one into silence. Surface `CR047`/`CR048` in
`lib/actions/client-requests.ts` as the migration's own comment promised, since
CR048 is reachable through the UI with no pre-check today. Definition of done: a
test that a client PATCH of `quoted_amount`/`client_decision` is rejected; a test
that re-quoting an approved request yields exactly one scope item and exactly one
pending approval; a test asserting the expired-quote error message reaches the
user.

**FP — Reconcile AS-003's badge with its view and with the contract.** Decide one
definition of "past due" for deliverables and put it in one place. The contract
text has no `blocking` qualifier, so `getOverdueBlockingDeliverableCount`
(`lib/queries/deliverables.ts:115`) should either drop `.eq("blocking", true)` or
the assertion should be read against a new appended assertion — it cannot stay as
it is. Align the `delivered` handling too: the badge counts overdue `delivered`
rows, `classifyBucket` (`your-list/page.tsx:37-41`) does not. Export the
classification from one module consumed by both. Fix the header at `:114,121` to
count delivered-or-better rather than accepted-only. Definition of done: one test
seeding an overdue non-blocking row and an overdue delivered row, asserting the
badge number and the view's section counts agree, in the same test.

**FQ — Make "Turn into decision" server-authoritative and visibility-aware.**
`lib/actions/project-records.ts:668-680` should fetch the comment from `commentId`
server-side and derive `commentText`, `commentAuthorName` and `commentCreatedAt`
from the row rather than trusting the browser, and should default
`client_visible` from the subject task's own `client_visible` (or prompt), rather
than hardcoding `true` — a one-click path from an internal comment to the portal
Scope page is the disclosure AS-045 exists to prevent. While there, replace
`confirmed_by_name = ctx.user.email` (`:857`) with a display name, scope
`phaseId` to the project in `createDecision`/`updateDecision` (`:395, :492`), and
add the prop sync `assumption-list.tsx:152` is missing.

**FR — Repair the tests that cannot fail.** Re-run the sweep inside
`f013…test.ts:347-374` so the manual-unblock case actually observes the next tick,
and decide-and-test what should happen (today it re-blocks hourly, contradicting
the migration's own header). Migrate the `tasks`, `project_phases`,
`active_timers`, `project_members` and `workspace_members` admin mocks in
`tests/unit/portal-overview-queries.test.ts` onto `applyFilters`, and seed at
least one `client_visible: false` risk fixture so the gate is asserted rather than
merely executed. Rename or invert
`test_AS_031_never_surfaces_a_delivered_deliverable_…` (`:685`), which asserts the
opposite of its name. Make `query-filter-mock.ts`'s `.not()` throw on an
unhandled operator instead of silently dropping it. Wrap the `afterAll` blocks in
`f013…test.ts:171-183` and `f016…test.ts:145-160` in `try/finally` with error
checks. Give `f016…test.ts:288-293` an error-code assertion — `expect(error)
.not.toBeNull()` passes on a typo'd RPC name.

---

## Toolchain output

### Typecheck — `npx tsc --noEmit`

```
(no output — clean)
```

### Lint — `npx eslint .`

```
✖ 19 problems (0 errors, 19 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

All 19 are `@typescript-eslint/no-unused-vars` on deliberately
underscore-prefixed mock parameters in pre-existing test files. Zero errors, none
in M3 files. (One fewer warning than M2 — nothing regressed.)

### Design-constraint sweep

```
$ git diff d845ab0^..9264a3e -- 'components/**' 'app/**' \
    | grep '^+' | grep -iE '#[0-9a-f]{3,8}\b|border-radius: *[0-9]+px|font-family'
(no matches)
```

### Tests

The full vitest suite was deliberately **not** run, per instruction — it
manufactures Supabase auth rate-limit failures and another worker is active.
Every finding above is derived from reading the migrations, the actions, the
queries, the components and the test sources.

Note for whoever runs the suite next: all four M3 integration suites are
`describe.skipIf(!haveCreds)`. Without `.env` they report green with zero
coverage of AS-028, AS-030, AS-032, AS-043–AS-048.

Where coverage is genuinely meaningful: AS-030, AS-032, AS-043, AS-044, AS-045
and AS-047 are backed by tests that read state back through an independent admin
client and would fail if the behaviour broke. For AS-003 the green is not
evidence (B4 — each path is tested against itself). For B1, B3, F-1's re-run,
F-2 and F-3 there is no test at all.
