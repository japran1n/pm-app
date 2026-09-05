# M3 Scrutiny — round 3, after F016g / F016f / F016b / F016h

Mission: 20260903-portal · Milestone M3 · Reviewed at `420a9ea`
Read-only. No code, test, migration or contract file was modified.
Full vitest suite deliberately not run (per instruction). Verification was done
against the **applied catalog** via the Management API query endpoint, plus
targeted test files, `tsc --noEmit`, `eslint`, and the migration-drift check.

---

## VERDICT

**M3 does not pass — one blocker, two majors.**

The three round-2 blockers are all genuinely closed, verified at the catalog
level and by live-database tests, not from migration text. Nothing that was
fixed in this milestone has been reverted again: composite FKs, `client_gate`
routing of all six RPCs, the guard trigger's `BEFORE INSERT OR UPDATE` and its
13-column list, the sweep's project join predicate and the F016e SELECT policy
all hold in the applied catalog.

F016g also broke nothing. I looked specifically for the call sites that do not
appear as `.rpc()` — trigger bodies, column defaults and generated columns, view
and matview definitions, index predicates and expressions, CHECK constraints,
RLS policy expressions, other functions' bodies, PostgREST computed columns,
dynamic SQL, and pg_cron commands. Every reachable one is either inside a
`SECURITY DEFINER` body, restricted to a role that still holds EXECUTE, or run
by `postgres`. There is no second `is_project_client` hiding anywhere.

But F016g did not achieve its second, forward-looking claim, and the proof is
already in the tree: **the `alter default privileges … revoke execute … from
public` is a no-op, so every function created after F016g is EXECUTE-granted to
PUBLIC, and therefore to `anon`.** The one function created after it —
F016h's own `clear_client_deliverable_swept_at` — is anon-executable today. M4
will add functions. That is the blocker.

---

## Assertion table

| ID | Verdict | Severity | Reason |
|---|---|---|---|
| AS-003 | **FAIL** | major | The badge still does not call the shared classifier; `getDeliverablesPastDueCount` re-expresses the predicate as PostgREST filters, and the agreement test compares `isDeliverablePastDue` to itself. |
| AS-028 | PASS | — | Composite FKs re-verified in the applied catalog, unchanged since round 2. |
| AS-030 | PASS | — | Sweep marks are per deliverable (== per pair, `task_id` is scalar); a task swept for A is re-blockable by B; `swept_at` cleared on acceptance, waiver and due-date change by an applied `BEFORE UPDATE` trigger. |
| AS-031 | PASS | — | `resolveHoldsUpContext` still project-scopes both admin reads; sweep's `t.project_id = cd.project_id` restored. |
| AS-046 | PASS | — | `flag_assumption_atomic` routes through `client_gate(v_project_id, v_client_visible)` in the applied body. |
| AS-047 | PASS | — | The INSERT hole is closed for every column the acceptance gate keys on; three live-DB tests cover it. |
| AS-048 | PASS | — | RLS half verified in the applied policy; render half now covered by a real jsdom test including the Expired branch. |
| AS-054 | PASS | — | Composite FK + project-scoped reads unchanged. |
| — (systemic) | **FAIL** | blocker | `alter default privileges … revoke execute on functions from public` did not take effect; new functions are granted EXECUTE to PUBLIC, hence to `anon`. |
| — (systemic) | **FAIL** | major | `client_requests.origin_assumption_id` is client-writable at INSERT, absent from the guard's column list, and dereferenced unscoped by the sync trigger. |

---

## 1. Did F016g break anything quietly? — No. But its future-default is a no-op.

### 1a. Nothing reachable was broken

101 functions in `public`; 37 now lack EXECUTE for `authenticated`, 74 lack it
for `anon`. I cross-joined those two sets against every expression in the
catalog that can invoke a function outside an `.rpc()` call:

- **column defaults and generated columns** (`pg_attrdef`) — no hits
- **CHECK constraints** (`pg_constraint contype='c'`) — no hits
- **index expressions and partial-index predicates** — no hits
- **view and matview definitions** (`pg_get_viewdef`) — no hits
- **RLS policy `USING` / `WITH CHECK`** — 8 hits, all
  `can_read_workspace_docs` / `can_write_workspace_docs` in the `docs` and
  `doc_folders` policies. Both functions are still executable by
  `authenticated`, and all eight policies have `polroles = {authenticated}`, so
  `anon` never evaluates them. **No break.**
- **other functions' bodies** (`pg_proc.prosrc`) — 6 hits, all inside
  `SECURITY DEFINER` bodies owned by `postgres`, where the definer's rights
  apply: `assert_portal_task_actionable_by_client` ← `approve_portal_task_atomic`
  and `request_portal_task_changes_atomic`; `recurrence_next_due_date` ←
  `generate_due_recurring_occurrences`; `seed_default_project_statuses` ←
  `seed_default_project_statuses_on_insert`; `tiptap_doc_from_text` and
  `tiptap_text_from_doc` ← `tasks_update_search_vector`. **No INVOKER body calls
  a function it can no longer execute.**
- **trigger invocation** — privilege is checked at `CREATE TRIGGER`, not at fire
  time, so the trigger functions in the revoked set are unaffected.
- **PostgREST computed columns** — no function in `public` takes a table
  composite type as its first argument. None exist to break.
- **dynamic SQL** — no function body contains `execute format(...)` or any other
  dynamic dispatch, so nothing is invisible to the static scan.
- **pg_cron** — all three jobs (`generate_due_recurring_occurrences`,
  `notify_overdue_task_assignees`, `sweep_overdue_blocking_deliverables`) run
  with `username = postgres`. Unaffected by the revoke.
- **every `.rpc()` site in the app** — 22 distinct function names across
  `app/`, `lib/`, `components/`. All 22 plus the six portal atomics are
  executable by `authenticated`. The only two that are not —
  `set_saved_view_default` (`lib/actions/views.ts:309`) and
  `reassign_and_delete_project_status` (`lib/actions/statuses.ts:670`) — are both
  called on the `createAdminClient()` service-role client, which retains EXECUTE.

`is_project_client`, `is_project_visible_to`, `is_project_portal_enabled`,
`is_project_workspace_writer` and `is_valid_timezone` all still hold EXECUTE for
both `anon` and `authenticated`, so the two cases found during implementation
stay fixed.

`tests/integration/f016g-default-acl-hardening.test.ts` (5 tests, passing) is a
genuine behavioural test — it calls `purge_task` and
`sweep_overdue_blocking_deliverables` over the wire as anon, as an authenticated
member and as the workspace owner, and asserts `permission denied`.

### 1b. BLOCKER — the future-default was not actually closed

`supabase/migrations/20261004010000_f016g_default_acl_and_unguarded_functions.sql:89-90`:

```sql
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
```

The stored entry looks right — `pg_default_acl` for `(postgres, public, f)` is
now `{postgres=X/postgres, service_role=X/postgres}`, with no PUBLIC. But
Postgres computes a new function's ACL as the **built-in default merged with**
the stored default ACL, and the built-in default for a function is `EXECUTE TO
PUBLIC`. The revoke of PUBLIC therefore has no effect.

Evidence, not inference. First, the only function created from scratch after
F016g:

```
clear_client_deliverable_swept_at()
  proacl = {=X/postgres, postgres=X/postgres, service_role=X/postgres}
  has_function_privilege('anon',  …, 'EXECUTE') = true
  has_function_privilege('authenticated', …, 'EXECUTE') = true
```

Second, a direct probe executed inside a `DO` block that raises at the end, so
the whole thing rolled back and the database is unchanged:

```
create function public.zz_acl_probe_tmp() returns int language sql as 'select 1';
→ PROBE_ACL = {=X/postgres,postgres=X/postgres,service_role=X/postgres}
ERROR: PROBE_ACL=… (rolled back)
```

Every function M4 creates in `public` will be granted EXECUTE to PUBLIC, i.e.
callable by `anon` over `POST /rest/v1/rpc/<name>`, unless its own migration
remembers to revoke. That is precisely the condition F016g exists to make
impossible, and it regressed inside the same milestone.

Today's exposure is nil — the one affected function returns `trigger`, so a
direct call errors with "trigger functions can only be called as triggers" and
PostgREST does not expose it. The severity is entirely forward-looking, which is
why it blocks *starting M4* rather than M3's own assertions.

Nothing in the test suite would catch this: `f016g-default-acl-hardening.test.ts`
tests two named existing functions, never a newly created one.

Secondary, minor: `pg_default_acl` still carries a `supabase_admin` entry for
`(public, f)` granting `anon`/`authenticated`. Harmless while migrations run as
`postgres`, but it is a second copy of the same trap.

---

## 2. Are the three round-2 blockers genuinely closed? — Yes, all three.

### B2 — INSERT bypass on `client_requests`: CLOSED

Applied trigger definition, from `pg_get_triggerdef`:

```
CREATE TRIGGER client_requests_enforce_triage_columns_immutable_by_author
  BEFORE INSERT OR UPDATE ON public.client_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_client_requests_triage_columns_immutable_by_author()
```

The applied function body has a distinct `TG_OP = 'INSERT'` branch rejecting a
row filed by its own author that already carries any of `scope_verdict`,
`quoted_hours`, `quoted_amount`, `quote_currency`, `quote_note`,
`quote_valid_until`, `client_decision <> 'pending'`, `decided_by`, `decided_at`,
`track`, `track_overridden <> false`, `track_override_reason`,
`approval_request_id`.

Critically, the acceptance gate in `accept_client_request_atomic` keys on
`scope_verdict = 'change_request'` and `client_decision = 'approved'` — both
guarded on both branches. AS-047 is genuinely enforced.

Three live-DB tests in `tests/integration/f016-change-request-quote-gate.test.ts`
(`:219`, `:230`, `:242`) assert the INSERT rejection over the wire and would fail
if the trigger reverted to `BEFORE UPDATE`.

The bypass GUC remains sound: three setters, each with a paired reset, all
`is_local => true`, no client-reachable path leaves it on, and no PostgREST verb
can set it.

### B1 — anon-reachable `purge_task` and the sweep: CLOSED

Both appear in the "no EXECUTE for `anon` or `authenticated`" set, and the
integration test exercises all five rejection paths live. `purge_task`'s new
internal owner check (`if auth.uid() is not null then … role = 'owner'`) is dead
code under its only real caller — `lib/actions/purge.ts:161` uses the service-role
client, where `auth.uid()` is null — but that path already enforces
`canPurge({ role })` at `lib/actions/purge.ts:152` before the RPC. Defence in
depth, not a gap.

### B3 — `swept_at` over-correction: CLOSED

The applied sweep body stamps `update client_deliverables set swept_at = now()
where id = v_row.deliverable_id` — only the deliverable this iteration cited,
replacing F016e's `where task_id = v_row.task_id`.

*Is a task swept for A still blockable by B?* Yes. The loop is `select distinct
on (t.id) … order by t.id, cd.due_at asc, cd.position asc`, so one run cites one
deliverable per task; B stays unstamped and survives `cd.swept_at is null`. While
the task is still in the blocked column, `t.status_id is distinct from
ps_blocked.id` suppresses repeat action — so no hourly nag — and the moment a
human moves the task out, B re-blocks it. Covered by a real integration test,
`tests/integration/f013-deliverables-review-and-sweep.test.ts:464`, which asserts
`d1.swept_at` non-null, `d2.swept_at` null, and the re-block after unblocking.
Reverting the stamp to the F016f form fails it.

*Is `swept_at` cleared on the three events?* The applied trigger function clears
when `new.due_at is distinct from old.due_at` **or** when state transitions into
`accepted`/`waived` from outside that set, on `BEFORE UPDATE … FOR EACH ROW` with
no `WHEN` clause and no column list — so every writer on the table fires it,
including `accept_deliverable_atomic` and `updateDeliverable`. All three events
are handled.

Caveat (major, listed below): only the due-date branch is tested. Deleting the
`state in ('accepted','waived')` line from the trigger keeps the whole suite
green. And no code path anywhere writes `state = 'waived'`, so that branch is
unreachable in the product as it stands.

Note the naming overstates the schema: `swept_at` is a column on
`client_deliverables`, not a `(deliverable, task)` pair table. It is equivalent
only because `client_deliverables.task_id` is a single scalar. Consequence:
re-pointing a stamped deliverable at a different task (`updateDeliverable` writes
`task_id`) leaves the stamp set, and the new task is never blocked by it. Minor.

---

## 3. Has anything been reverted again? — No. Every M3 invariant holds in the applied catalog.

| Invariant | Applied state | Holds? |
|---|---|---|
| Composite FK `client_deliverables (task_id, project_id) → tasks (id, project_id)` | `ON DELETE SET NULL (task_id)`, `confdelsetcols={4}` | yes |
| Composite FK `(phase_id, project_id) → project_phases (id, project_id)` | `ON DELETE SET NULL (phase_id)`, `confdelsetcols={3}` | yes |
| All six client-facing RPCs route through `client_gate` | `flag_assumption_atomic`, `mark_deliverable_delivered_atomic`, `accept_client_request_atomic`, `assert_portal_task_actionable_by_client`, `send_change_request_quote_atomic`, `raise_change_request_from_assumption_atomic` — all six call it in their applied bodies | yes |
| `send_change_request_quote_atomic` un-reverted | `client_gate(v_project_id, p_require_client_role => false, p_require_project_visible => false)` | yes |
| Guard trigger timing | `BEFORE INSERT OR UPDATE` | yes |
| Guard trigger column list | 13 columns, identical on both branches | yes |
| Sweep project join predicate | `join tasks t on t.id = cd.task_id and t.project_id = cd.project_id` | yes |
| F016e SELECT policy without `created_by` | `client_requests_select_author_or_team` unchanged | yes |
| `raise_change_request_from_assumption_atomic` team-writer gate | present, matching `accept_client_request_atomic` | yes |

The guard against re-reversion, `tests/unit/f016f-client-gate-revert-guard.test.ts`,
is a **source-text** test — it greps the latest `create or replace` body out of
the migration files and regex-matches `/public\.client_gate\(/`. It passes if the
call is commented out, if the flags neuter it, or if the reset of the bypass GUC
is deleted. It never executes anything. It is better than nothing for catching a
literal `create or replace` revert, which is the failure mode that actually
occurred twice, but it should not be mistaken for behavioural coverage.

Also worth recording: for `accept_client_request_atomic`,
`send_change_request_quote_atomic` and
`raise_change_request_from_assumption_atomic`, `client_gate` is called with both
`p_require_client_role` and `p_require_project_visible` false, so it collapses to
exactly `is_project_portal_enabled(project_id)` — behaviourally identical to the
inline check F016e reverted to. For those three the restoration is stylistic.

---

## Open items, ranked

### 1. BLOCKER — default EXECUTE to PUBLIC on every future function

`supabase/migrations/20261004010000_f016g_default_acl_and_unguarded_functions.sql:89-90`.
Trigger: create any function in schema `public` as `postgres`. Demonstrated on
`public.clear_client_deliverable_swept_at()`
(`supabase/migrations/20261006010000_f016h_swept_at_per_pair.sql:37`), which is
anon-executable in the applied catalog. Blocks M4 because M4 adds functions and
nothing would surface the exposure.

### 2. MAJOR — `client_requests.origin_assumption_id` is client-writable and dereferenced unscoped

`supabase/migrations/20261003010000_f016b_raise_change_request_from_assumption.sql:31`
adds the column with a plain `FOREIGN KEY (origin_assumption_id) REFERENCES
project_assumptions(id) ON DELETE SET NULL` — no project scoping. It is absent
from the guard trigger's 13-column list and unpinned by
`client_requests_insert_own`'s `WITH CHECK`, so a client can `POST
/client_requests` with `origin_assumption_id` set to any assumption UUID.
`client_requests_sync_decision_from_approval` then does `update
public.project_assumptions set state = 'invalidated' where id =
v_request.origin_assumption_id` (`:280-285`) with no project predicate. Trigger:
client files a request naming an assumption of their choosing, team quotes it,
client approves — the chosen assumption flips to `invalidated`. Same shape as the
`approval_request_id` hijack F016f closed, on a column added one migration later.
Also unguarded, lower impact: `severity` (written by the quote RPC, so genuinely
a triage field), `kind`, `reviewed_at`.

### 3. MAJOR — AS-003: the badge still does not use the shared classifier

`lib/queries/deliverables.ts:143-158` re-expresses the past-due predicate as
PostgREST filters; `isDeliverablePastDue` (`:114-119`) has exactly two callers,
the your-list page and its own test. The comment at `:105-113` claiming one
predicate for both surfaces is inaccurate. The two agree today for all five
states, but nothing binds them: `tests/unit/f016h-classify-bucket-and-badge-agreement.test.ts:96-113`
computes its "badge count" by calling `isDeliverablePastDue` directly and its
"view count" via `classifyBucket`, which also calls `isDeliverablePastDue` — the
assertion compares a function to itself and can never fail. Green-keeping
mutation: change `lib/queries/deliverables.ts:145` from
`new Date().toISOString().slice(0,10)` to `new Date().toLocaleDateString("en-CA")`;
badge and view then disagree across UTC midnight and the suite stays green.
(The per-state `classifyBucket` cases at `:45-84` and the filter-recording mock in
`tests/unit/portal-overview-queries.test.ts:160-183` *are* real tests — round 2's
`delivered` divergence is genuinely fixed and would fail on revert.)

### 4. MAJOR — `swept_at` clearing on acceptance/waiver is untested, and `waived` is unwritable

Deleting `supabase/migrations/20261006010000_f016h_swept_at_per_pair.sql:45`
removes half the trigger's contract with the suite still green. Separately, no
code path in `app/`, `lib/`, `components/` or any migration ever writes
`state = 'waived'` — it appears only in read-side exclusion predicates.

### 5. MINOR — `task_id` reassignment leaves `swept_at` set

`lib/actions/deliverables.ts:355` writes `task_id`; the clearing trigger watches
only `due_at` and `state`. A stamped deliverable moved to another task can never
block the new one.

### 6. MINOR — no team-side render test for AS-048

`components/client-requests/team-request-inbox.tsx:144-158` renders price, hours
and decision badge with zero test references. AS-048 says "the portal shows",
so the portal-side test satisfies the assertion as written; the team surface is
uncovered on the same theory F016h used to justify covering the portal one.

### 7. MINOR — the revert guard is a source-text test

`tests/unit/f016f-client-gate-revert-guard.test.ts`. See section 3.
`latestFunctionBody()` also takes `contents.indexOf(marker)`, the *first*
definition in a file, so a migration defining the same function twice is
mis-read.

---

## Recommended follow-up features

**F016i — close the default-privilege hole for real, and prove it.** The
`alter default privileges … revoke execute on functions from public` in F016g
does not take effect, because Postgres merges the stored default ACL with the
built-in `EXECUTE TO PUBLIC`. Replace the mechanism with one that actually holds:
add an event trigger on `ddl_command_end` for `CREATE FUNCTION` in schema
`public` that revokes EXECUTE from `public`, `anon` and `authenticated` on the
newly created function, or — if an event trigger is judged too broad — establish
a repo convention enforced by a test rather than by a default privilege. Either
way, retro-fix `public.clear_client_deliverable_swept_at()`, whose ACL currently
contains `=X/postgres`. The feature is not done without a test that **creates a
function and asserts `has_function_privilege('anon', …, 'EXECUTE') = false`** —
the existing F016g test only checks two named pre-existing functions and would
not have caught this. A migration-lint test asserting that every function in
`public` has a non-null `proacl` with no PUBLIC entry would also serve.

**F016j — guard `origin_assumption_id`, `severity` and `kind`, and scope the
assumption dereference.** Add `origin_assumption_id`, `severity` and `kind` to
`enforce_client_requests_triage_columns_immutable_by_author`'s column list on
both the INSERT and UPDATE branches, with the bypass GUC covering
`raise_change_request_from_assumption_atomic`'s own insert. Independently, make
the write in `client_requests_sync_decision_from_approval` project-scoped —
`update project_assumptions set state='invalidated' where id =
v_request.origin_assumption_id and project_id = v_request.project_id` — so the
column cannot reach outside the request's own project even if the guard is later
weakened, mirroring what F016c did for deliverable task links. Tests must be
behavioural and live-DB, in the style of the three INSERT tests already in
`f016-change-request-quote-gate.test.ts`: a client POSTs a request naming an
assumption in another project and the write is rejected; and a client POSTs one
naming an in-project assumption they were not offered, and the eventual approval
does not invalidate it. Add coverage for the eight guarded columns currently
untested (`quoted_hours`, `quote_currency`, `quote_note`, `quote_valid_until`,
`decided_at`, `track`, `track_overridden`, `track_override_reason`) — dropping
any of them from the guard today keeps the suite green.

**F016k — make the badge call the shared past-due classifier, and test the
sharing rather than the agreement.** `getDeliverablesPastDueCount` should fetch
the candidate rows and count them through `isDeliverablePastDue`, or the two
surfaces should both derive from a single exported filter description, so that
"one predicate" is a structural property rather than a coincidence two comments
assert. The accompanying test must exercise `getDeliverablesPastDueCount` itself
against the your-list classification — the current agreement test compares
`isDeliverablePastDue` to `classifyBucket`, which calls it, and cannot fail. A
single injected "today" value shared by both call sites would also close the
timezone divergence. While here, add the missing trigger test: accept a stamped
deliverable and assert `swept_at` is null afterwards, so
`20261006010000:45` is no longer deletable in silence.

---

## Command output

### `npx tsc --noEmit`

```
(no output — clean)
```

### `npx eslint .`

```
✖ 19 problems (0 errors, 19 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

All 19 are pre-existing `@typescript-eslint/no-unused-vars` warnings on
underscore-prefixed mock parameters in test files. Exit code 0.

### `node --env-file=.env scripts/check-migration-drift.mjs`

```
✓ No migration drift — all migrations present on remote.
```

### Targeted test files (full suite deliberately not run)

```
$ npx vitest run tests/unit/f016f-client-gate-revert-guard.test.ts \
                 tests/unit/f016h-change-requests-table-render.test.tsx \
                 tests/unit/f016h-classify-bucket-and-badge-agreement.test.ts \
                 tests/unit/portal-overview-queries.test.ts

 Test Files  4 passed (4)
      Tests  51 passed (51)
   Duration  546ms

$ npx vitest run tests/integration/f016g-default-acl-hardening.test.ts

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  5.89s
```

### Catalog probe (rolled back, database unchanged)

```
$ do $probe$ declare a text; begin
    execute 'create function public.zz_acl_probe_tmp() returns int language sql as $b$select 1$b$';
    select coalesce(proacl::text,'NULL') into a from pg_proc … where proname='zz_acl_probe_tmp';
    raise exception 'PROBE_ACL=% (rolled back)', a;
  end $probe$;

ERROR: P0001: PROBE_ACL={=X/postgres,postgres=X/postgres,service_role=X/postgres} (rolled back)
```
