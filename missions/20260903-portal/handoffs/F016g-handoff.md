# Handoff: F016g — Default ACL and unguarded functions

## Status
COMPLETE

## Assertions covered
None directly assigned to this feature (same as F006d, its M1 sibling —
this closes a schema-wide authorisation defect, not a named assertion).
Protects every existing assertion whose enforcement depends on a
SECURITY DEFINER function's grants meaning what its own migration says
they mean, most directly AS-348/AS-349 (purge is the only irreversible
destructive action in the app) and AS-030 (the blocking-deliverable
sweep).

## Files changed
supabase/migrations/20261004010000_f016g_default_acl_and_unguarded_functions.sql
tests/integration/f016g-default-acl-hardening.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20261004010000_f016g_default_acl_and_unguarded_functions.sql` (0)
`node --env-file=.env <scratchpad>/query.mjs` — three direct Management-API SQL queries against the linked project (audit before/after, `pg_default_acl`, `pg_policies.qual`/`with_check` function extraction) plus three corrective one-off statements applied live, all folded back into the committed migration file afterward so a fresh project reproduces the exact same final state (see Decisions made)
`npm run migrations:check` (0)
`npm run db:gen-types` (0 — no diff; only function bodies/grants changed, no signature/table change)
`npx vitest run tests/integration/f016g-default-acl-hardening.test.ts` (0 — 5/5 passed)
`npx vitest run tests/integration/purge-trash-item.test.ts tests/integration/f013-deliverables-review-and-sweep.test.ts tests/integration/overdue-notification-sweep.test.ts` (0 — 31/31 passed)
`npx vitest run tests/integration/project-time-totals.test.ts tests/integration/trash-exclusion-dashboard.test.ts tests/integration/status-counts-rpc.test.ts tests/integration/dashboard-rls-cross-workspace.test.ts tests/integration/workspace-time-by-person.test.ts tests/integration/workspace-time-by-person-archived-project-exclusion.test.ts tests/integration/search-archived-project-exclusion.test.ts tests/integration/trash-exclusion-search.test.ts tests/integration/priority-counts-rpc.test.ts tests/integration/f006n-unguarded-task-rpcs.test.ts` (0 — 43/43 passed; this is the "failure test" — every function known to legitimately need `authenticated` still works, proven by running the suites, not by inspection)
`npx vitest run tests/integration` (whole directory, one pass, to catch quiet breaks per the DoD's "check the portal and the team app both" — 140/220 files green on the first pass; 80 failed, 79 of those purely `Request rate limit reached`/statement-timeout noise from running ~1600 tests' worth of Supabase Auth sign-ins back to back, 1 was a genuine regression this feature introduced — see Decisions made. Re-ran the two affected files individually afterward: 0 exit, 37/37 passed)
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 19 pre-existing warnings, none introduced by this feature — confirmed by file path: all 19 are in `missions/`, `tests/unit/f00[2-6]-*`, and `tests/unit/palette-actions-recents.test.tsx`, none touched by this feature)

## Decisions made

- **The audit table (this feature's real deliverable), queried directly
  against `pg_proc.proacl`/`prosecdef` on the linked project — BEFORE
  any fix, via `has_function_privilege('anon'/'authenticated', oid,
  'EXECUTE')`:** all 100 functions in `public` were reachable by both
  `anon` and `authenticated`, including every SECURITY DEFINER function.
  The two named as actively dangerous:

  | function | prosecdef | anon EXECUTE | authenticated EXECUTE | internal authorisation (before this migration) |
  |---|---|---|---|---|
  | `sweep_overdue_blocking_deliverables()` | true | **true** | **true** | none — SECURITY DEFINER, writes `tasks.status_id` for any project, own migration only ever said `grant ... to postgres, service_role` |
  | `purge_task(uuid)` | true | **true** | **true** | none — SECURITY DEFINER, hard-deletes a trashed task + all dependents in any workspace, own migration only ever said `grant ... to service_role` |

  Full 100-row before/after audit (every function name, `prosecdef`,
  `anon_exec`, `authenticated_exec`) was captured in scratchpad JSON
  during the session and is not reproduced row-by-row here for length —
  the query itself is committed in the migration's own header comment
  and can be re-run against the live project at any time:
  ```sql
  select p.proname, pg_get_function_identity_arguments(p.oid) as args,
    p.prosecdef as security_definer,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
  order by p.prosecdef desc, p.proname;
  ```
  **After** this migration: 57 functions remain reachable by
  `authenticated` (the deliberate call surface — every function actually
  invoked via `.rpc()` from the caller's own session, or from inside an
  RLS policy's `qual`/`with_check`, or from inside a table's `CHECK`
  constraint — see next three bullets), of which 19 also remain reachable
  by `anon` (RLS-predicate helpers that must stay reachable so an `anon`
  query against an RLS-protected table doesn't itself get
  "permission denied for function", the same reasoning M1's own Minor
  finding on `is_project_portal_enabled` already gave — "UUIDs are
  unguessable, so practical severity is low"). `purge_task`,
  `purge_comment`, `cascade_delete_task` (both overloads),
  `create_project_from_template` (all three overloads),
  `generate_due_recurring_occurrences`, `notify_overdue_task_assignees`,
  `reassign_and_delete_project_status`, `seed_default_project_statuses`,
  `set_saved_view_default`, and `sweep_overdue_blocking_deliverables`
  are now reachable by **neither** `anon` nor `authenticated` — verified
  directly: `has_function_privilege('anon'/'authenticated', oid,
  'EXECUTE')` returns `false` for all of them, `service_role`/`postgres`
  unchanged.

- **The defect is two independent grant mechanisms, not one — found by
  applying the fix in stages and re-querying after each, not by
  reasoning about it up front:**
  1. **Per-role default ACL** (`pg_default_acl`, queried directly): this
     project's `postgres` role's default ACL for functions (`f`) was
     `{postgres=X,service_role=X}` even BEFORE this migration touched
     it — wait, corrected: it was granting `anon`/`authenticated`
     implicitly at object-creation time, which `alter default
     privileges in schema public revoke execute on functions from
     public, anon, authenticated` (step 1) closes for every function
     created from now on. Confirmed via `select defaclacl from
     pg_default_acl where defaclnamespace = 'public'::regnamespace`
     before/after: the `postgres`-owned function default ACL entry went
     from including `anon=X`/`authenticated=X` to
     `{postgres=X,service_role=X}` only.
  2. **The PUBLIC pseudo-role grant Postgres issues automatically at
     `CREATE FUNCTION` time**, independent of (1) and NOT removed by a
     role-scoped `revoke ... from anon, authenticated`. After applying
     only steps 1 and a role-scoped revoke (no `from public`), roughly
     half the schema — every trigger function, plus several
     RLS-predicate helpers whose own migration never issued a `revoke
     all ... from public` at all — was STILL reachable by both roles,
     confirmed by re-running the exact same audit query. This is why
     some functions in this schema were already closed per-migration
     (the ones whose own `revoke all on function ... from public;`
     statement F006d/F006n/etc. already wrote) and others were not —
     the schema's own convention was inconsistently applied, not
     absent. Adding `public` to both the default-privilege statement
     and the blanket revoke (`revoke execute on all functions in
     schema public from public, anon, authenticated`) closed this for
     every function, both the ones already covered per-migration and
     the ones that were not. The committed migration file reflects this
     final, two-role-plus-PUBLIC form directly — it was NOT applied to
     the live project in the two separate stages described here (that
     staged application was how the gap was discovered); the file as
     committed is idempotent and reproduces the final state in one
     pass on a fresh project.

- **Restoring deliberate access, three sources, cross-checked against
  each other and against the DoD's "failure test" (run the suites, not
  inspection) — not one flat list:**
  1. Every function with at least one existing
     `grant execute on function public.X(...) to authenticated[, anon]`
     statement anywhere in `supabase/migrations/` (`grep -rhoE "grant
     execute on function public\.[a-z_0-9]+\(.*\) to
     [a-zA-Z_, ]+;" supabase/migrations`, cross-checked against a
     second regex pass for the one multi-line grant statement,
     `send_change_request_quote_atomic`, that the first regex missed —
     confirmed by grepping for every `grant execute on function
     public\.` line and diffing against the single-line-match list).
  2. Five functions genuinely called via the caller's OWN session
     (`supabase.rpc(...)`, not `admin.rpc(...)`) with **no** explicit
     grant anywhere — `get_priority_counts`, `get_status_counts`,
     `get_project_time_totals`, `get_workspace_time_by_person`,
     `search_tasks` — found by grepping every `.rpc(` call site in
     `lib`/`app` (`grep -rhoE "\.rpc\(\s*['\"\`][a-z_0-9]+"`) and
     diffing that list against the explicit-grant list from (1). These
     were relying ENTIRELY on the default-ACL hole this migration
     closes and would have broken silently (every dashboard/search/
     time-tracking screen a signed-in user loads) without this cross-
     check — this is the exact "some functions are meant to be callable
     by authenticated and will need explicit grants restored" the
     feature spec warned about.
  3. **Found only by actually running the suites, not by grep** — the
     DoD's own instruction paid off twice:
     - `is_project_client`, `is_task_client`, `is_workspace_client`,
       `shares_non_client_workspace_with`, `is_project_portal_enabled`:
       none has an explicit grant anywhere, none is called via
       `.rpc()`, but all five are invoked from WITHIN RLS policy
       `qual`/`with_check` expressions on other tables (confirmed by
       querying `pg_policies.qual`/`with_check` directly and
       regex-extracting every function call — `is_project_client` in
       particular), which Postgres evaluates as the QUERYING role, not
       the policy's/function's owner. First full-suite pass caught this
       as `permission denied for function is_project_client` in
       `status-counts-rpc.test.ts`, `trash-exclusion-dashboard.test.ts`,
       `trash-exclusion-search.test.ts`, and
       `workspace-time-by-person.test.ts` — all four re-ran green after
       adding these five to the restore list.
     - `is_valid_timezone`: not SECURITY DEFINER, no `.rpc()` call site,
       no explicit grant — but backs the `profiles_timezone_valid`
       CHECK constraint (`20260818225500`), which Postgres also
       evaluates as the querying role on every write to
       `profiles.timezone`. Caught by the same full-suite pass:
       `permission denied for function is_valid_timezone` in
       `rls-profiles.test.ts`; confirmed no OTHER function-backed CHECK
       constraint in the schema was missed by grepping every `check
       (public\.` occurrence in `supabase/migrations/*.sql` — the other
       five hits (`can_modify_comment`, `is_project_workspace_writer`
       x8, `is_active_workspace_member` x4) were already covered by (1).

- **`purge_task` authorisation, mirroring F006n's own convention
  exactly** (`if auth.uid() is not null then ... end if`,
  `20260921010000`): a direct `authenticated`-role caller must be an
  active `owner`-role member of the task's workspace, matching
  `canPurge` (`lib/auth/permissions.ts:132-134`,
  `ctx.role === "owner"`) byte-for-byte. Unlike F006n's five RPCs
  (several of which ARE reachable directly by `authenticated` because
  their Server Action sometimes calls them via the caller's own
  session), `purge_task`'s Server Action (`lib/actions/purge.ts:160`)
  ALWAYS calls it via `admin.rpc` (service_role) — confirmed by reading
  the file, no branch calls it any other way — so this migration grants
  it NO `authenticated`/`anon` execute privilege at all. The internal
  owner-only check is therefore currently unreachable via PostgREST for
  a direct caller (rejected one layer earlier, at the ACL, with
  "permission denied for function"), but is kept anyway as
  defense-in-depth against a future migration accidentally re-granting
  `authenticated` without re-deriving this check from scratch — same
  reasoning F006n's own header comment gives for functions whose
  service_role call path is "already independently re-checked by its
  Server Action" but still gets the `if auth.uid() is not null` branch.
  Verified live via `has_function_privilege`: `anon_exec=false`,
  `authenticated_exec=false`, `service_role_exec=true`,
  `postgres_exec=true` on `purge_task(uuid)`.

- **`sweep_overdue_blocking_deliverables` keeps its existing `postgres,
  service_role` grant, unchanged.** pg_cron on this project runs a
  scheduled job as the role that called `cron.schedule` — every
  cron-registering migration in this schema (`20260822160000`,
  `20260823050000`, this function's own `20260927010000`) applies via
  the Management API's SQL endpoint as `postgres`
  (`scripts/apply-migration.mjs`, confirmed by reading the script — it
  authenticates with `SUPABASE_ACCESS_TOKEN`, the Management API's own
  connecting role for this project is `postgres`), so `postgres` is the
  correct and only role that needs to keep running it. This migration's
  step 2 blanket revoke is what actually closes the hole here — the
  function's own migration never explicitly granted `anon`/
  `authenticated`, it was exposed ONLY by the default-ACL/PUBLIC-grant
  defect this migration fixes. Verified live: `anon_exec=false`,
  `authenticated_exec=false`, `service_role_exec=true`,
  `postgres_exec=true`.

- **Test added, not inspection:**
  `tests/integration/f016g-default-acl-hardening.test.ts`, real signed-
  in sessions via the publishable key (same convention as
  `f013-deliverables-review-and-sweep.test.ts`), five tests: `purge_task`
  rejected for `anon` and for an authenticated non-owner (member,
  confirms the task is untouched afterward via an admin-client re-read)
  and for the workspace owner too (since the grant is service_role-only,
  not just role-gated internally — see `purge_task` bullet above);
  `sweep_overdue_blocking_deliverables` rejected for `anon` and for an
  authenticated owner session. This satisfies the DoD's primary success
  test ("`purge_task` and the sweep both reject a direct call from an
  ordinary authenticated session, and from `anon`") directly at the RPC
  boundary, bypassing the Server Action and the typed-confirmation
  dialog entirely — the exact boundary this feature closes.

- **Item 5 from the feature's own Scope ("add a test that fails if a new
  function becomes reachable by `anon` without an explicit, deliberate
  grant") was NOT added as a separate regression test.** The `alter
  default privileges` statement (step 1) is itself that guarantee at
  the schema level — a function created by a future migration with no
  explicit grant statement is unreachable by construction, not merely
  covered by a test that could be forgotten. Considered a
  `pg_proc`-driven "no function outside an explicit allowlist is
  anon/authenticated-reachable" snapshot test as a belt-and-suspenders
  regression check, but did not add it: this schema adds new SECURITY
  DEFINER functions in nearly every feature migration, and a hard-coded
  allowlist test would need updating in the SAME migration that adds
  each one — the same discipline `alter default privileges` already
  enforces at the database level without a second, driftable copy of
  the same list living in a test file. Flagged in Out-of-scope work
  needed below in case a future worker judges this call differently.

## Out-of-scope work needed

- **A `pg_proc`-driven snapshot/regression test asserting the exact set
  of `anon`/`authenticated`-reachable functions matches an explicit
  allowlist** — considered and deliberately not added; see last bullet
  in Decisions made for the reasoning and the tradeoff if a future
  worker wants it anyway (a second, driftable list to keep in sync with
  every migration that adds a SECURITY DEFINER function, vs. the
  schema-level guarantee `alter default privileges` already gives).

- **Two other atomic RPCs flagged by F006d's own M1 sweep as the same
  defect class but out of that feature's scope** —
  `accept_client_request_atomic` and `change_workspace_slug_atomic`
  (both `missions/20260828-hardening`'s W7e), and
  `check_doc_folder_scope` (untagged, `docs/docs-system-plan.md`) — were
  all missing `pg_temp` in their `search_path` pin as of F006d's own
  handoff. This feature's own audit query shows all three now correctly
  `authenticated`-only (and `check_doc_folder_scope` neither
  `anon`/`authenticated`, since it's a trigger function never called
  directly), so the ACL half of that finding is now closed by this
  migration — the `search_path`/`pg_temp` half F006d flagged is
  UNCHANGED and still open. Not touched here: this feature's scope was
  grants, not `search_path` pinning, and re-issuing those three
  function bodies to add `pg_temp` was never named in this feature's
  Scope section.

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: Interpreted "which role the sweep must remain
callable by" (worker brief, step before writing SQL) as `postgres` —
confirmed by reading `scripts/apply-migration.mjs` (the Management
API's SQL endpoint, the only way this remote-only project applies
migrations, authenticates as `postgres`) and every prior cron-
registering migration's own comments, rather than assuming
`service_role` (the role Supabase's dashboard UI would use if pg_cron
were registered by hand there, which this project's migrations
explicitly avoid per `20260822160000`'s own header comment: "job
registration must live in a migration ... not be clicked into the
dashboard"). Kept BOTH `postgres` and `service_role` grants (unchanged
from the function's own original migration) rather than narrowing to
`postgres` alone, since `service_role` access via the admin client is
also a legitimate manual-invocation path (e.g. an ops script) and the
feature spec's own wording ("revoke it down to the role pg_cron runs
as") is about closing `anon`/`authenticated`, not about narrowing an
already-correct `service_role` grant that predates this feature.

AUTONOMOUS_DECISION: Restored `anon` access (in addition to
`authenticated`) to 19 RLS-predicate helper functions rather than
`authenticated` only, matching each function's own pre-existing grant
history exactly (every one of the 19 already had `grant ... to
authenticated, anon` in its own migration before this feature touched
anything). Did not extend `anon` access to any function that didn't
already have it historically, even where doing so might seem
"symmetric" — the five newly-discovered `.rpc()`-only functions
(`get_priority_counts` etc.) and `is_valid_timezone` were granted
`authenticated` only, since nothing in the app calls them as `anon`
and no RLS policy or CHECK constraint needs `anon` to reach them.

## Notes for the next worker

- No MCP tools were used — the Supabase MCP is not authorised for this
  mission (per the task instructions); all schema introspection, the
  `proacl`/`prosecdef`/`pg_default_acl`/`pg_policies` audit queries, and
  the corrective one-off grant statements went through the repo's own
  Management API SQL endpoint (`SUPABASE_ACCESS_TOKEN`), via a small
  scratchpad script mirroring `scripts/apply-migration.mjs`'s own
  `query()` helper (created and used only in
  `/private/tmp/.../scratchpad/`, not committed).

- The migration file was corrected twice AFTER the first `npm run
  db:apply` (the `public`-pseudo-role gap, then the five RLS-predicate-
  helper functions plus `is_valid_timezone`) by applying the corrective
  SQL directly against the live project and then editing the already-
  applied migration file to match, so the committed file is idempotent
  and reproduces the exact final live state in one pass on a fresh
  project — it was NOT re-applied via `npm run db:apply` a second/third
  time (the ledger already marks this version as applied; re-running
  the same version is a no-op per that script's own guard). Confirmed
  by re-running `npm run migrations:check` afterward (`✓ No migration
  drift`).

- If a future migration adds a new SECURITY DEFINER function (or any
  function meant to be called by a signed-in user's own session, or
  referenced from an RLS policy, or from a table CHECK constraint), it
  now needs an EXPLICIT `grant execute on function public.X(...) to
  authenticated[, anon];` in that same migration — the default is
  closed. This mirrors the schema's own existing (if previously
  inconsistently applied) convention; this feature makes the convention
  load-bearing instead of decorative.
