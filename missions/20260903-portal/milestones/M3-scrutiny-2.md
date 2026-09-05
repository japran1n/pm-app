# M3 Scrutiny — round 2, after F016c / F016d / F016e

Mission: 20260903-portal · Milestone M3 · Reviewed at `fd91957`
Read-only. No code, test, migration or contract file was modified.
Full vitest suite deliberately not run (per instruction). Verification was done
against the **applied schema** via the Management API query endpoint, plus
targeted unit tests, tsc and eslint.

---

## VERDICT

**M3 still does not pass.** Three blockers, three majors.

The cross-workspace blocker (round 1's B1) **is genuinely closed** — I confirmed
it at the catalog level and by executing the writes against the live database,
not by reading the migration. That part of the remediation is correct and I have
no objection to it.

But the three remediation features introduced or left standing three
independently sufficient reasons not to start M4:

1. The whole grant model for cron-only SECURITY DEFINER functions is a no-op.
   `sweep_overdue_blocking_deliverables` — this milestone's own function — is
   executable by `anon`.
2. The F016d column guard is `BEFORE UPDATE` only. The client INSERT policy pins
   none of the twelve columns, so the guard is bypassed by creating the row
   rather than editing it.
3. F016e's `swept_at` fix trades an hourly-nag defect for permanent suppression
   of legitimate future blocks, and stamps deliverables the sweep never acted on.

AS-003 and AS-048 are both still FAIL.

---

## Assertion table

| ID | Verdict | Severity | Reason |
|---|---|---|---|
| AS-003 | **FAIL** | major | The `blocking` divergence is fixed, but badge and view are still two independent classifications and still disagree on state `delivered`; `classifyBucket` has zero test coverage. |
| AS-028 | PASS | — | Composite FK verified live; cross-project INSERT and UPDATE both rejected `23503`, same-project accepted. |
| AS-030 | **FAIL** | blocker | `swept_at` permanently suppresses a legitimate later block, and is stamped on deliverables the sweep never acted on (B3). |
| AS-031 | PASS | — | `resolveHoldsUpContext` scopes both admin reads by `project_id` (`lib/queries/deliverables.ts:200, 219`). |
| AS-046 | PASS | — | `flag_assumption_atomic` now routes through `client_gate(v_project_id, v_client_visible)` — gate set matches `project_assumptions_select_client` conjunct for conjunct. |
| AS-047 | **FAIL** | blocker | The quote gate is bypassable at INSERT: a client can create a request already carrying `scope_verdict`, `quoted_amount`, `client_decision='approved'` (B2). |
| AS-048 | **FAIL** | major | RLS half is correct and well tested; the render half is untested end to end, has no expired-quote state, and `quoted_hours` is optional so "estimate" can be absent. |
| AS-054 | PASS | — | Composite FK + project-scoped admin reads; no cross-project title/slug/phase-name can reach the portal. |
| — (systemic) | **FAIL** | blocker | `revoke all ... from public` does not remove Supabase's default explicit grants to `anon`/`authenticated` (B1). |

---

## Answers to the four questions

### 1. Is the cross-workspace blocker genuinely closed? — **Yes.**

Verified against the applied schema, not the migration text.

`pg_get_constraintdef` on `public.client_deliverables`:

```
client_deliverables_task_id_fkey   FOREIGN KEY (task_id, project_id)
    REFERENCES tasks(id, project_id) ON DELETE SET NULL (task_id)
client_deliverables_phase_id_fkey  FOREIGN KEY (phase_id, project_id)
    REFERENCES project_phases(id, project_id) ON DELETE SET NULL (phase_id)
```

`pg_constraint.confdelsetcols` resolves to `{task_id}` and `{phase_id}`
respectively — the PG15 column-list form parsed and stored exactly as the worker
believed, confirmed from the catalog. `tasks_id_project_id_key` and
`project_phases_id_project_id_key` both exist as `UNIQUE (id, project_id)`.
`confupdtype = 'a'` (NO ACTION on update), which is the safe direction.

Executed against the live database inside a rolled-back `DO` block:

```
INSERT_CROSS = REJECTED 23503
INSERT_SAME  = OK
UPDATE_CROSS = REJECTED 23503
MOVE_PROJECT = REJECTED 23503   (changing the deliverable's project_id
                                 while task_id points at the old project)
TASK_DELETE  = OK   task_id_null=true   project_id preserved
PHASE_DELETE = OK   phase_id_null=true  project_id preserved
```

So the write is prevented at the database level, not merely in the action, and
the `ON DELETE SET NULL (col)` construct does exactly what was claimed —
`project_id` survives an ordinary task or phase delete.

`resolveHoldsUpContext` (`lib/queries/deliverables.ts:196-224`) now applies
`.eq("project_id", projectId)` to the `tasks` read and to the `project_phases`
read. The read half is closed.

**One regression, non-exploitable (minor).** F016c added
`and t.project_id = cd.project_id` to the sweep's join
(`20260930020000…:132`). F016e's `create or replace` of the same function
dropped it — the applied body is `join tasks t on t.id = cd.task_id`
(`20261002010000…:327`), and the second statement
(`update client_deliverables set swept_at = now() where task_id = …`, `:357-364`)
has no project predicate either. Unreachable today because the composite FK
holds. F016c's function comment, still applied, now asserts a predicate that is
not in the body.

### 2. Does `client_gate` close the class, or move it? — **It closes AS-046. The class moved to INSERT.**

`client_gate(p_project_id, p_client_visible default true, p_require_client_role
default true, p_require_project_visible default true, p_require_portal_enabled
default true)` — `stable security definer`, `search_path = public, pg_temp`,
`coalesce(p_client_visible, false)` so NULL fails closed.

Call sites, all five in `20261001010000`:

| caller | call | verdict |
|---|---|---|
| `flag_assumption_atomic` `:213` | `client_gate(v_project_id, v_client_visible)` | correct — AS-046 fixed |
| `assert_portal_task_actionable_by_client` `:581` | `client_gate(v_project_id, v_client_visible, p_require_client_role => false)` | correct; role checked inline `:569-578` |
| `mark_deliverable_delivered_atomic` `:297` | `p_require_client_role => false` | fine — table has no `client_visible` column |
| `accept_client_request_atomic` `:660` | portal-only | fine — team-only, bars `client` at `:650` |
| `decide_approval_atomic` `:414` | `p_require_project_visible => false` | pre-existing gap, preserved not introduced (see M2) |

The sixth caller **no longer exists**: F016e replaced
`send_change_request_quote_atomic` and reverted it to an inline
`is_project_portal_enabled` check (`20261002010000…:123`), and dropped the
`set_config` bypass pair F016d had wrapped its UPDATE in. Harmless today only
because the quote RPC bars the `client` role while the client INSERT policy
requires `is_project_client`, so `new.created_by = auth.uid()` cannot be true for
a quoter. Dead by coincidence.

**The bypass flag itself is sound.** `app.client_requests_triage_guard_bypass`,
read as `coalesce(current_setting(..., true), 'off') = 'on'` — unset yields NULL
→ `'off'`, fails closed. Nothing else can set it: no exposed function takes a GUC
name; `pg_catalog.set_config` is not in a PostgREST-exposed schema and PostgREST
has no `SET` verb; `is_local => true` plus one-transaction-per-request means a
direct `PATCH` never sees it; both writers reset immediately after their single
UPDATE and neither has an `exception` block, so an error rolls the local GUC back
with the transaction; `authenticated` has neither `CREATEROLE` nor superuser so
it cannot `ALTER ROLE ... SET`. The only client-reachable bypass-setting function
is the sync trigger, which brackets exactly one statement and resets before the
`project_scope_items` insert. **No hole here.** The real hole is elsewhere — B2.

### 3. Did the remediation break a legitimate path? — **One of the four, yes.**

- **Deliverable whose task is deleted — PASS.** `purge_task`
  (`20260822220000…:114`) still succeeds; only `task_id` is nulled. No code path
  anywhere writes `tasks.project_id` after insert, so `ON UPDATE NO ACTION` is
  never exercised. Soft delete/restore untouched. Every insert path sets
  `project_id` and `task_id` in the same statement.
- **Re-quoted twice — PASS.** The withdraw is `... set state='withdrawn' where id
  = v_prior and state='pending'` (`20261002010000…:136-141`), and
  `prevent_approval_request_settled_update` only raises when `OLD.state <>
  'pending'`, so it never trips. The scope-item insert's `on conflict
  (change_request_id) where (source='change_request' and change_request_id is not
  null) do nothing` (`:277-279`) is textually identical to the index predicate
  (`:212-214`), so inference succeeds and an already-approved prior yields no
  23505. (Deploy risk, not a code path: the unique index at `:212` has no dedupe
  pass ahead of it, unlike F016c's; it will fail on any environment that already
  has a duplicate.)
- **Sweep on a task blocked for an unrelated reason — BROKEN.** See B3.
- **Team member updating a client request through the UI — PASS.** The trigger
  raises only inside `if new.created_by = auth.uid()`
  (`20261001010000…:979-982`), and short-circuits on `auth.role() =
  'service_role'` at `:956`. Every writer enumerated: `declineClientRequest`
  touches no guarded column; `accept_client_request_atomic` touches none; the
  sync trigger carries the bypass. No team write is lost or errors.

### 4. Are AS-003 and AS-048 now genuinely true? — **No, both still FAIL.**

**AS-003.** The claim "one unified query behind both surfaces" is false in the
code. The Your list page never imports `getDeliverablesPastDueCount`; it keeps
its own `classifyBucket` (`app/(portal)/portal/[workspaceSlug]/p/[projectId]/your-list/page.tsx:37-41`).
Of the divergence axes, `blocking` is genuinely fixed and project/`due_at`/
timezone handling agree — but **state `delivered` still diverges**: the badge
counts it (`.not("state","in","(accepted,waived)")`,
`lib/queries/deliverables.ts:129`), `classifyBucket` routes it to `"progress"`
(`:39`) and never to `"blocked"`. One past-due `delivered` deliverable → badge
shows 1, the page it links to shows zero blocked. The comment at
`lib/queries/deliverables.ts:101-118` asserting the unification is inaccurate.

Test quality: `tests/unit/helpers/query-filter-mock.ts:28-59` genuinely applies
its filters — re-adding `.eq("blocking", true)` does fail
`portal-overview-queries.test.ts`. That mock is not a rubber stamp, and this is
an improvement. But the badge fixtures (`:471-487`) contain **no `delivered`
row**, so the one axis that still diverges is unexercised, and `classifyBucket`
has no test at all (`grep -rl "classifyBucket\|your-list" tests/` → nothing).
`portal-sidebar.test.tsx:146` feeds `deliverablesPastDue: 3` as a literal.
Green-keeping mutation, one line: change `your-list/page.tsx:40` to `return
"waiting";` — every past-due item stops being blocked and the suite stays green.

**AS-048.** The RLS half is fixed and well tested. The applied policy is
`client_requests_select_author_or_team`: `(is_project_client and
is_project_visible_to and is_project_portal_enabled) or (is_project_visible_to
and not is_project_client)` — `created_by = auth.uid()` is gone, and
`f016-change-request-quote-gate.test.ts:344-408` creates a genuine second client
user and asserts both sessions see both requests. That test would fail on a
revert. Good.

The render half is not. The AS-048 surface is
`components/portal/change-requests-table.tsx` (not `request-list.tsx`, which
renders neither estimate nor price). There is **no render test anywhere** —
`grep -rl "ChangeRequestsTable\|quote-details\|quote-state-" tests/` returns
nothing; deleting `change-requests-table.tsx:112-115`, the estimate and price
entirely, keeps every test green. Substantively: `quoted_hours` is optional in
both the RPC (`20260930010000…:155-156`) and
`lib/validation/client-requests.ts:60`, so a priced quote can render **no
estimate**; and `quoteStateLabel` (`:45-55`) has no expiry branch, so an expired
quote still reads "Awaiting your approval" while
`accept_client_request_atomic:364` refuses it forever.

---

## Findings, ranked

### B1 — blocker — every cron-only SECURITY DEFINER function is callable by `anon`

`supabase/migrations/20260927010000_f013…:262-263`:

```sql
revoke all on function public.sweep_overdue_blocking_deliverables() from public;
grant execute on function public.sweep_overdue_blocking_deliverables() to postgres, service_role;
```

`revoke ... from public` removes the **PUBLIC pseudo-role** grant. Supabase's
`pg_default_acl` for functions in this database is
`{postgres=X, anon=X, authenticated=X, service_role=X}` — those are **explicit
per-role grants applied at CREATE time**, which `revoke from public` does not
touch. The applied ACL is therefore:

```
sweep_overdue_blocking_deliverables
  proacl = {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
```

Read straight from `pg_proc.proacl`, not inferred. The function is in `public`,
takes no arguments and returns `integer`, so PostgREST exposes it at
`POST /rest/v1/rpc/sweep_overdue_blocking_deliverables`.

**State that triggers it.** Anyone holding the publishable key — which ships to
every browser — POSTs that endpoint. It runs SECURITY DEFINER with no
authorisation check of any kind, across **every project in every workspace in the
database**: moving tasks into Blocked, writing `task_activity` rows, and (post
F016e) stamping `swept_at`, which under B3 permanently suppresses those
deliverables' future legitimate blocks. It can be called in a loop.

The same idiom leaves three more intended-restricted functions open, verified in
`proacl`: `purge_task` (granted `to service_role` only,
`20260822220000…`), `notify_overdue_task_assignees`, and
`generate_due_recurring_occurrences`. **`purge_task` is the worst of them**: its
body performs no authorisation check whatsoever — it relies entirely on the
grant — and it hard-deletes a soft-deleted task's checklist items, comments,
timers, time entries and attachments, returning the Storage object paths to the
caller. Any authenticated user of any workspace can purge any trashed task in the
database given its UUID.

M3 owns the sweep. The other three predate this milestone but are live now and
the fix is one shared idiom.

**Fix:** `revoke all on function ... from public, anon, authenticated;` after
every `create [or replace] function`, and add a schema-wide audit query as a
test — `select proname from pg_proc where has_function_privilege('anon', oid,
'EXECUTE')` compared against an explicit allowlist. Nothing in the suite can see
this class today.

### B2 — blocker — the F016d column guard is `BEFORE UPDATE` only; the INSERT policy pins nothing

Trigger: `20261001010000…:990-991`, `before update on public.client_requests`.
There is no INSERT trigger. The applied INSERT policy
`client_requests_insert_own` has

```
with check (created_by = auth.uid() and is_project_client(project_id)
  and is_project_visible_to(project_id) and is_project_portal_enabled(project_id)
  and status = 'submitted' and converted_task_id is null and reviewed_by is null)
```

— nothing about `scope_verdict`, `quoted_hours`, `quoted_amount`,
`quote_currency`, `quote_note`, `quote_valid_until`, `client_decision`,
`decided_by`, `decided_at`, `track`, `track_overridden`,
`track_override_reason`, `approval_request_id`. F016d's own header reasons
entirely about UPDATE and never considers INSERT.

**State that triggers it, (a) the quote gate.** A client `POST`s
`/client_requests` with `scope_verdict='change_request'`,
`client_decision='approved'`, `quoted_amount=0`, `quote_valid_until=null`.
`accept_client_request_atomic` (`20261001010000…:669-679`) then passes both
`CR047` (`v_client_decision is distinct from 'approved'`) and `CR048`
(`v_quote_valid_until is not null and ... < current_date`). The client has minted
an approved, never-quoted change request that the team's accept path treats as
commercially settled. `scope_verdict='in_scope'` skips the block entirely.
This is AS-047's gate, defeated. Round 1 rated the equivalent UPDATE reach as
"integrity and deception, not privilege escalation" — at INSERT it is escalation,
because no team RPC ever moves the row out of `submitted` first.

**State that triggers it, (b) hijacking the sync trigger.** The client sets
`approval_request_id` at insert to the id of any existing pending
`decision_type='commercial'`/`subject_type='artifact'` approval on their project
(one exists as soon as the team has quoted them once). When they then approve
that approval through `decide_approval_atomic`, the sync trigger's lookup
(`20261002010000…:236-239`) is `select ... from client_requests cr where cr.id =
NEW.subject_id and cr.approval_request_id = NEW.id` — `select into` on a
multi-row result takes one row without error. The attacker's fabricated request
can win, inserting the client's own `title`/`body` into `project_scope_items` as
`source='change_request', included=true` — a client-authored, client-visible
scope line the team never agreed to — while the legitimate request's sync is
silently dropped.

**Fix:** make the guard `before insert or update`, pinning the twelve columns
(plus `approval_request_id`) to NULL on insert when `created_by = auth.uid()`,
or add them to the INSERT policy's `with check` as `is null`.

### B3 — blocker — `swept_at` suppresses legitimate future blocks (AS-030)

`grep -rn swept_at` over the whole repo returns only the migration,
`database.types.ts`, and one test comment. **Nothing resets it, anywhere.**

**B3a — permanent suppression.** `updateDeliverable`
(`lib/actions/deliverables.ts:346-358`) can push `due_at` into the future and
back into the past, and `state` can leave `accepted`/`waived`. Once `swept_at` is
set, `and cd.swept_at is null` (`20261002010000…:341`) suppresses that
deliverable's block **forever**. A re-missed, extended deadline never blocks
again.

**B3b — stamping rows the sweep never acted on.** `:357-364`:

```sql
update client_deliverables set swept_at = now()
 where task_id = v_row.task_id and blocking
   and state not in ('accepted','waived')
   and due_at is not null and due_at < (now() at time zone 'utc')::date
   and swept_at is null;
```

`distinct on (t.id)` picked **one** deliverable as the cause; this stamps
**every** overdue blocking deliverable on that task. D1 and D2 both overdue on
task T; the sweep blocks T citing D1; both are stamped. D1 is accepted, a human
unblocks T. D2 is still overdue, blocking and unaccepted — and the sweep will
never block T again. That is precisely "silently skips a task it should block",
and AS-030's whole point.

Behaviour when a human blocked the task for an unrelated reason is fine:
`t.status_id is distinct from ps_blocked.id` (`:344`) excludes the row, so no
`swept_at` accrues. The defect is B3a/B3b, not that case.

Round 1's F-1 (hourly re-blocking) is genuinely fixed. It was over-corrected.

### B4 — major — AS-003: badge and view still disagree on `delivered`, and the view has no test

See question 4. Severity major rather than blocker because it is a display
inconsistency, not a security or data defect. The green-keeping one-line mutation
is the reason this is FAIL rather than "met but fragile".

### B5 — major — AS-048's render path is entirely untested, and misrepresents expired quotes

See question 4. `change-requests-table.tsx:45-55` has no expiry branch;
`quoted_hours` is optional so "estimate" can be absent; no test asserts any of
the three values reach the DOM.

### B6 — major — F016e silently reverted two of F016d's changes

`send_change_request_quote_atomic` no longer routes through `client_gate`
(`20261002010000…:123` vs `20261001010000…:776`), and no longer sets the bypass
flag around its UPDATE. F016d's stated purpose — one predicate, one place —
lasted exactly one migration. Separately, F016e reverted F016c's
`t.project_id = cd.project_id` join predicate while leaving F016c's function
comment claiming it. Neither is exploitable today; both are the "two things that
must agree and silently stopped agreeing" shape this mission has now produced at
four consecutive gates.

### Minor

- The unique index `project_scope_items_change_request_id_unique`
  (`20261002010000…:212`) has no dedupe pass ahead of it. It will fail at deploy
  on any environment that already carries the duplicate the index exists to
  prevent — the exact failure mode F016c explicitly avoided.
- `client_gate`'s `p_client_visible boolean default true` is permissive by
  default. Its own comment (`20261001010000…:150-151`) tells callers they must
  remember to pass the real column value. A default that must be remembered is
  the checklist the function was created to replace.
- `mark_deliverable_delivered_atomic` passes `p_require_client_role => false` and
  nothing re-checks role, so a `viewer` can flip a deliverable to `delivered`.
  Possibly intended (the header says "any active member"), but every other write
  RPC in the tree excludes `viewer` explicitly.
- `decide_approval_atomic` returns `v_resulting_task_id` (`:524`) for a task it
  inserted with `client_visible = false` (`:459-466`). Under a strict AS-054
  reading ("absent from every RPC response") a non-client-visible row's
  identifier does appear in an RPC response.
- Round 1's F-2 (upload before the authoritative gate, no rollback on `rpcError`),
  F-3 ("Turn into decision" hardcodes `client_visible: true` and trusts
  browser-supplied text), and the F-4 list were not in these three features'
  scope and remain open as written.

---

## Recommended follow-up features

**FS — Fix the grant idiom database-wide, and add an audit test that can see it.**
`revoke all on function ... from public` is a no-op against Supabase's default
per-role grants to `anon` and `authenticated`. Every function that is meant to be
cron-only or service-role-only is currently callable by anyone holding the
publishable key. Add a migration that issues `revoke all on function ... from
public, anon, authenticated` for `sweep_overdue_blocking_deliverables`,
`purge_task`, `notify_overdue_task_assignees` and
`generate_due_recurring_occurrences`, and give `purge_task` an internal
authorisation check so it is not defended by its grant alone. Then add a test
that queries `pg_proc` for every function where `has_function_privilege('anon',
oid, 'EXECUTE')` is true and diffs it against a checked-in allowlist, so the next
function that forgets fails the suite rather than shipping. Definition of done: a
test asserting an `authenticated`-role session receives `42501` from
`/rpc/sweep_overdue_blocking_deliverables` and from `/rpc/purge_task`; the
allowlist test present and failing if a new function is added without a grant
decision.

**FT — Close the client_requests INSERT hole.** The F016d guard trigger covers
`UPDATE` only and the INSERT policy pins none of the thirteen triage/quote/
decision columns, so a client can create a request already carrying
`client_decision='approved'` and defeat AS-047's acceptance gate outright, and
can point `approval_request_id` at an existing pending commercial approval to
hijack `client_requests_sync_decision_from_approval` into writing their own text
into `project_scope_items`. Change the trigger to `before insert or update` and
require all thirteen columns to be NULL on an author INSERT (or add them to
`client_requests_insert_own`'s `with check`). While there, make the sync
trigger's lookup deterministic — `select into` on a two-row result silently takes
one — and consider a unique constraint on `client_requests.approval_request_id`.
Definition of done: a test that a client INSERT carrying `client_decision` or
`quoted_amount` is rejected; a test that `accept_client_request_atomic` raises
CR047 for a self-declared-approved request; a test that two requests cannot share
one `approval_request_id`.

**FU — Make `swept_at` a fact about a sweep, not a permanent tombstone.** Today it
is set on every overdue blocking deliverable of a swept task, never reset, and
therefore permanently disables AS-030 for those rows. Either clear `swept_at`
whenever `due_at` or `state` changes (a `BEFORE UPDATE` trigger on
`client_deliverables`), or scope the second UPDATE to the deliverable
`distinct on` actually chose, or replace the whole mechanism with a record of
the human override on the *task* (which is what the migration header actually
describes) rather than on the deliverable. Restore the
`t.project_id = cd.project_id` join predicate F016e dropped, add it to the
`swept_at` UPDATE too, and correct F016c's now-false function comment. Definition
of done: a test where two deliverables are overdue on one task, the first is
accepted and a human unblocks the task, and the next sweep re-blocks it citing
the second; a test where a deliverable's due date is extended and re-missed and
the next sweep blocks.

**FV — Make AS-003 one classification, and give AS-048's render path a test.**
Export a single `classifyDeliverable`/`isPastDue` from one module and have both
`getDeliverablesPastDueCount` and the Your list page consume it, so the
`delivered` divergence cannot exist; the badge currently counts a past-due
`delivered` row that the page it links to shows as in progress. Add one test
seeding a past-due `delivered` row and a past-due `not_started` row and asserting
the badge number equals the view's blocked-section count in the same test — the
current fixtures have no `delivered` row and `classifyBucket` has no test at all.
Separately, render-test `change-requests-table.tsx`: assert estimate, price and
state reach the DOM for a quoted request, decide what to show when
`quoted_hours` is null (AS-048 says "estimate"), and add the missing expired
branch to `quoteStateLabel` so the portal stops saying "Awaiting your approval"
for a quote `accept_client_request_atomic` will refuse.

**FW — Re-route `send_change_request_quote_atomic` through `client_gate` and make
the gate fail closed.** F016e's replacement reverted it to an inline
`is_project_portal_enabled` check and dropped the trigger bypass, one migration
after F016d introduced both. Restore the routing, restore the `set_config`
bracket (it is dead only by coincidence today), and change `client_gate`'s
`p_client_visible` default from `true` to no default so a caller must state the
value rather than inherit a permissive one. Definition of done: a test that a
team member who is themselves the `created_by` of a request can quote it; a
grep-style test asserting every client-callable RPC's gate goes through
`client_gate`.

---

## Toolchain output

### Typecheck — `npx tsc --noEmit`

```
(no output — clean, exit 0)
```

### Lint — `npx eslint .`

```
✖ 19 problems (0 errors, 19 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

All 19 are `@typescript-eslint/no-unused-vars` on deliberately
underscore-prefixed mock parameters in pre-existing test files. Zero errors,
none in M3 files. Unchanged from round 1 — nothing regressed.

### Tests

Full suite deliberately not run (instruction: another worker is active; a full
run manufactures Supabase auth rate-limit failures). Targeted unit run only:

```
$ npx vitest run tests/unit/portal-overview-queries.test.ts
 Test Files  1 passed (1)
      Tests  28 passed (28)
```

Everything else in this report is derived from reading the migrations, actions,
queries, components and test sources, and — for the schema claims — from querying
the **applied** database catalog (`pg_constraint`, `pg_proc`, `pg_policies`,
`pg_trigger`, `pg_default_acl`) and executing rolled-back write probes.

### Live schema probes (all inside rolled-back `DO` blocks)

```
INSERT_CROSS=REJECTED 23503; INSERT_SAME=OK; UPDATE_CROSS=REJECTED 23503; MOVE_PROJECT=REJECTED 23503;
TASK_DELETE=OK task_id_null=true project_id=98e29acb-…; PHASE_DELETE=OK phase_id_null=true project_id=98e29acb-…;
```

```
client_deliverables_task_id_fkey   FOREIGN KEY (task_id, project_id)  REFERENCES tasks(id, project_id) ON DELETE SET NULL (task_id)     confdelsetcols={task_id}
client_deliverables_phase_id_fkey  FOREIGN KEY (phase_id, project_id) REFERENCES project_phases(id, project_id) ON DELETE SET NULL (phase_id)  confdelsetcols={phase_id}
tasks_id_project_id_key            UNIQUE (id, project_id)
project_phases_id_project_id_key   UNIQUE (id, project_id)
```

```
sweep_overdue_blocking_deliverables
  proacl = {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
purge_task
  proacl = {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
pg_default_acl (postgres, functions) = {postgres=X, anon=X, authenticated=X, service_role=X}
```
