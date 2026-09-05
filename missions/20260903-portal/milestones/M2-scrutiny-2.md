# M2 Scrutiny — round 2 (focused re-review after remediation)

Mission: 20260903-portal · Milestone M2 · Reviewed at `96d9991`
Scope: the three questions asked, not a re-audit. Read-only.

---

## VERDICT

**M2 passes. Start M3.**

The blocker is genuinely gone and AS-024 still holds at every boundary an
authenticated caller can reach. The second decision path is closed at the
database layer, in the one helper both RPCs already shared, with no third
caller. The signed-URL read path is gated by the same RLS SELECT policy
that gates every other approval read, so neither an invisible approval nor
a portal-disabled project yields a URL.

Three residuals are recorded below. None of them blocks M3; two are
follow-up features, one is a note.

---

## Q1 — Is the blocker gone, and is AS-024 still true?

**Yes, and yes.**

`prevent_approval_request_settled_update` (20260924010000) now raises 42501
only when one of `state`, `decided_by`, `decided_at`, `decision_note` is
`IS DISTINCT FROM` its old value on a settled row. `IS DISTINCT FROM` is
the right operator — `decision_note` and `decided_at` are nullable, and
`<>` would have let a null-to-value write slip through. The trigger body
contains no role test, no `pg_trigger_depth()`, no `current_user` check,
so it fires identically for `authenticated`, `service_role`, and the
internal referential-action context. The FK's `ON DELETE SET NULL` on
`resulting_task_id` touches none of the four columns, so `purge_task`'s
`delete from tasks` now completes.

Verified by test, not by reading:
`tests/integration/f011-decide-approval-creates-task.test.ts` gained
`test_AS_024_purge_of_a_linked_resulting_task_succeeds_and_the_settled_decision_survives_unchanged`
(settles, trashes, purges, re-reads and asserts all four decision fields
byte-identical and `resulting_task_id` null) and
`test_AS_024_a_direct_update_to_a_settled_decisions_own_fields_is_still_rejected`,
which issues four separate updates — one per guarded column — **through the
admin (service_role) client** and asserts `42501` on each. That is the
right client for this assertion; an `authenticated` session would have been
stopped by RLS and proved nothing about the trigger. The `afterAll` now
throws on any cleanup error instead of swallowing it, which is what let the
original bug reach the M2 gate.

**Did the narrowing open a path to rewrite `subject_id`, `project_id`,
`artifact_url` or `round` on a settled row?** Not for any caller the app
exposes. `approval_requests_update_team` (20260916010000) is the only
UPDATE policy on the table and its `WITH CHECK` is
`is_project_workspace_writer(project_id) and state = 'pending' and
decided_by is null and decided_at is null`. On a settled row the NEW tuple
still carries `state <> 'pending'` and a non-null `decided_by`, so the
WITH CHECK fails regardless of which column the writer aimed at. There is
no client UPDATE policy. So every `authenticated` write to a settled row is
still refused — by RLS rather than by the trigger, but refused.

What genuinely changed is defence-in-depth for `service_role` and for
future SECURITY DEFINER code: those can now rewrite `subject_id`,
`project_id`, `artifact_url`, `round`, `title`, `supersedes_id` on a
settled row, where before the trigger froze the whole tuple. Audit of the
current surface says nothing does: `grep "update approval_requests"` across
all migrations returns exactly four sites (20260916:420 withdraw,
20260920:104, 20260923:231, 20260925:248), all inside SECURITY DEFINER
RPCs that operate only on `state = 'pending'` rows; no application file
issues an admin-client `.update()` against `approval_requests`. This is a
real reduction in the blast radius of a future mistake, and the migration
header says so honestly and tells the next migration author to audit the
trigger. Recorded as **major follow-up**, not a failure of AS-024, whose
subject is the decision.

DELETE remains enforced only by the absence of a DELETE policy — unchanged
from round 1, and sufficient for `authenticated`. Still worth a BEFORE
DELETE trigger; see follow-ups.

**AS-024: PASS.**

---

## Q2 — Did the shared predicate actually close the second path?

**Yes.**

`is_project_decision_owner(project_id, decision_type, user_id)` is SQL,
`stable`, SECURITY DEFINER with `search_path` pinned to `public, pg_temp`
(so it does not reintroduce the pg_temp shadowing 20260908010000 fixed),
revoked from `public`, granted to `authenticated`. Its
`p_decision_type is null` branch is "owns at least one type on this
project"; the non-null branch is exact-type.

Both surfaces reach it:

- `decide_approval_atomic` (20260925010000) calls it with the request's own
  `v_decision_type`, in the same position the inline lookup occupied, above
  the `changes_requested` branch. `portal_enabled` gate still fires first.
- `assert_portal_task_actionable_by_client` (20260925010000) calls it with
  `p_decision_type := null`, as its last check.

Ordering is safe. 20260925010000 is the newest migration in
`supabase/migrations` — nothing redefines either function afterwards. I
diffed the new `assert_portal_task_actionable_by_client` body against the
20260918010000 version it replaces: it is identical (auth, `FOR UPDATE OF
t` row lock, deleted/missing task, active client `workspace_members`,
`is_project_visible_to`, `is_project_portal_enabled`, `client_visible`,
`pending`) plus the new owner check. No check was dropped in the rewrite —
that was the specific way this could have gone wrong and it did not.

**No third caller.** `grep` for `approve_portal_task_atomic |
request_portal_task_changes_atomic | assert_portal_task_actionable_by_client`
across migrations, `lib`, `app`, `components` shows the two RPCs are the
only callers of the helper, both `perform * from
assert_portal_task_actionable_by_client(p_task_id)` as their sole
authorisation, and `lib/actions/portal-approval.ts` is the only application
caller of either RPC. The only other write of
`tasks.pending_client_approval` from application code is
`lib/actions/client-visibility.ts:199`, which is the team raising the flag,
gated by `tasks_update_active_members` (clients excluded).

`requestApproval` now loads `portal_enabled` in `loadProjectExtra` and
refuses on a portal-disabled project (F-2 from round 1, closed).

**AS-022: PASS**, with one bounded residual: the two surfaces refuse the
same *reported* client (owns nothing) but are not fully symmetric — a
client owning only `content` is refused on a `brand` approval request yet
may still clear a legacy task flag, because that flag carries no decision
type to compare against. Given AS-022's wording ("the named decision owner
for an approval's decision type"), the flag is not an approval and this
mapping is defensible. The migration header states the tradeoff explicitly.

---

## Q3 — Did the remediation introduce anything?

**Signed URL — no. The two attacks you named both fail.**

`getApprovalDocSnapshotUrl` (`lib/actions/approvals.ts:600-648`) does the
authorisation read with the **RLS-respecting** server client
(`createClient()`, not `createAdminClient()`), selecting the
`approval_requests` row by id. That read is governed by
`approval_requests_select_client`, which requires
`is_project_client(project_id) and is_project_visible_to(project_id) and
is_project_portal_enabled(project_id)`, or by
`approval_requests_select_team`. So:

- *Approval they cannot see* → `maybeSingle()` returns null → `"Approval
  request not found."` No storage call is made.
- *`portal_enabled` false* → the client SELECT policy's third conjunct
  fails → same null → same refusal. Confirmed by policy text, not by the
  action's own logic.

Only after that read succeeds is the admin client reached, and only to call
`createSignedUrl` on the path stored on that very row — the path is never
caller-supplied, so there is no traversal or object-substitution surface.
TTL is one hour, matching `getAttachmentSignedUrl`. The URL is minted per
click and never persisted client-side.

One consequence worth stating, not a defect introduced here: a doc-subject
approval's client SELECT policy has no subject-visibility prerequisite (it
applies only to `subject_type = 'task'`), so a client can now open the
**body snapshot** of a doc they could not otherwise read. Before F009c they
got only the title. This is the intended meaning of "the team sent this doc
for approval", but it is a wider disclosure than the round-1 state and it
is the first thing to check if the doc-visibility question is ever
revisited. Not a regression against any M2 assertion.

**AS-002's test can now fail.** The `project_decision_owners` mock branch
was migrated to `applyFilters`/`eqFilter` with a thenable builder (the real
source awaits the chain directly after its second `.eq()`, so a `.then()`
was required rather than a terminal method — the mock matches the real
call shape). `test_AS_002_another_clients_owned_decision_type_is_not_counted`
now seeds a real `brand` row for `CLIENT_USER_ID` and signs in as
`OTHER_CLIENT_USER_ID`; exclusion comes from the query's own
`.eq("user_id", user.id)`, not from a hand-set `[]`. Removing that filter
from `lib/queries/portal.ts:543` makes `ownedTypes = ['brand']` and the
expected count 0 becomes 1 — red. The test has the ability to fail.
**AS-002: PASS.**

**AS-021: PASS.** A doc-subject approval renders an Open control backed by
the signed URL, with its own `useTransition` so it cannot disable Approve;
`artifactSnapshotPath` is carried through `APPROVAL_COLUMNS` and
`mapApprovalRow`. The write-only storage object now has a reader.

---

## Assertion table (deltas from round 1 only)

| ID | Round 1 | Now | Severity | Reason |
|---|---|---|---|---|
| AS-002 | FAIL | **PASS** | — | Owner mock on `applyFilters`; dropping `.eq("user_id")` turns the suite red. |
| AS-021 | FAIL | **PASS** | — | Doc snapshot openable via RLS-gated signed URL; write-only object now read. |
| AS-022 | FAIL | **PASS** | — | Both RPC families reach `is_project_decision_owner`; no third caller; no check dropped in the helper rewrite. |
| AS-024 | FAIL (blocker) | **PASS** | — | Purge succeeds; all four decision fields still 42501 for service_role, tested per column. |
| AS-019, AS-020, AS-023, AS-025, AS-026, AS-027 | PASS | PASS | — | Untouched by remediation. |

---

## Follow-ups (not blocking M3)

**FM — restore full-tuple immutability without re-breaking the FK.** The
trigger now guards four columns by name, so a future column on
`approval_requests` is unprotected by default and `service_role` can
rewrite `subject_id`/`project_id`/`artifact_url`/`round` on a settled row.
Invert the check: raise when any column other than an explicit allow-list
(`resulting_task_id`, `phase_id`, `updated_at`) differs, using
`to_jsonb(NEW) - allowlist IS DISTINCT FROM to_jsonb(OLD) - allowlist`, so
new columns are frozen by default and the FK's referential nulling still
passes. In the same pass add the `BEFORE DELETE` trigger AS-024's "or
deleted" clause currently gets only from the absence of a DELETE policy,
with a test that a service_role delete of a settled row is rejected.

**FN — no-decision-owner projects can no longer use the legacy portal task
approve.** `assert_portal_task_actionable_by_client` now requires the
client to own at least one decision type, so on any project where the team
never configured `project_decision_owners`, a client clicking Approve on a
shared task gets the generic `"Something went wrong. Please try again in a
moment."` from `lib/actions/portal-approval.ts:127-133`. This is the
correct authorisation outcome and the wrong message. Distinguish the
"no decision owner is configured for this project" case in the action and
surface an actionable message, and decide whether raising an approval
should be what sets `tasks.pending_client_approval` at all — today the two
flows still coexist and only one of them creates an `approval_requests`
row.

Round 1's F-3 (guest guard on the approvals queue), F-4 (trashed subject
tasks in "what it blocks"), F-5 (queue recomputed on every workspace
render) and F-6 remain open and unaddressed by this remediation. They were
majors/minors then and still are; none of them touches an M2 assertion.

---

## Toolchain output

Full vitest suite deliberately not run, per instruction (it manufactures
Supabase auth rate-limit failures). Targeted runs only.

### Typecheck — `npx tsc --noEmit`

```
(no output — clean, exit 0)
```

### Tests — targeted

```
$ npx vitest run tests/unit/portal-overview-queries.test.ts \
    components/portal/approval-card.test.tsx
 Test Files  2 passed (2)
      Tests  37 passed (37)
   Duration  946ms
```

The two AS-024 integration tests and the F009b suite
(`tests/integration/f009b-close-second-approval-path.test.ts`, 484 lines)
were read, not executed — they are `describe.skipIf(!haveCreds)` and the
run would have hit the same auth rate limit. Their assertions were verified
by reading: the AS-024 pair uses the service_role client and asserts
`42501` per guarded column, which is the correct oracle.
