# Handoff: F082 — Security audit: five authorization holes

## Status
COMPLETE

## Assertions covered
This is an ad hoc security-audit task, not tied to validation-contract.md
assertion IDs. Per-hole verdicts below stand in for assertion coverage;
each has a dedicated failing-then-passing test.

hole-1 (transfer_workspace_ownership takeover): PASS — see
tests/integration/security-authz-holes.test.ts "hole 1"
hole-2 (remove_workspace_member arbitrary eviction): PASS — "hole 2"
hole-3 (change_workspace_slug_atomic rename-anyone): PASS — "hole 3"
hole-4 (guest workspace-wide write vs project-scoped read): PASS — "hole 4"
hole-5 (generate_unique_project_key anon existence oracle): PASS — "hole 5"

## Files changed
supabase/migrations/20261025010000_security_audit_authz_holes.sql (new)
tests/integration/security-authz-holes.test.ts (new)

## Commands run
`npx vitest run tests/integration/security-authz-holes.test.ts` (0, before fix: 5 failed as expected; after fix: 5 passed)
`npx vitest run tests/integration/transfer-ownership.test.ts tests/integration/remove-member.test.ts tests/integration/change-workspace-slug.test.ts tests/integration/rls-guest.test.ts` (0, 34 passed)
`npx vitest run tests/integration/f016i-anon-execute-catalog.test.ts tests/integration/db-task-keys.test.ts tests/integration/f002-phase-management.test.ts tests/integration/f014-mark-deliverable-delivered.test.ts tests/integration/f018-budget-threshold-sweep.test.ts` (0, 57 passed)
`npm run db:apply -- supabase/migrations/20261025010000_security_audit_authz_holes.sql` (0)
`npm run migrations:check` (0, "No migration drift — all migrations present on remote.")
`npx tsc --noEmit` (0)
`npm run build` (0)

## Decisions made

Per-hole mechanism, fix chosen, and why:

**Hole 1 — `transfer_workspace_ownership`.** Mechanism confirmed by
reading supabase/migrations/20260822085141_transfer_workspace_ownership_atomic.sql:16-124:
SECURITY DEFINER, validates only the *target*'s membership/status, never
checks who is calling. Confirmed the only application caller is
`lib/actions/workspaces.ts` `transferOwnership()` (grep for the RPC name
across lib/ and app/ found no other call site), which already
re-authorizes via `requireWorkspaceOwner()` before issuing the RPC
through `createAdminClient()` — a service-role client
(`lib/supabase/admin.ts`, `SUPABASE_SECRET_KEY`), where `auth.uid()` is
null. **Fix chosen: (b) revoke the `authenticated` grant entirely**,
keeping `service_role`. Stronger than an in-body check because a function
nothing can call cannot be called wrongly, and an `auth.uid()`-based
in-body check would have been a no-op protection anyway on the
service-role call path (auth.uid() is null there) while doing nothing to
close the direct-PostgREST hole for an `authenticated` caller — the grant
itself was the entire problem.
Test: `security-authz-holes.test.ts` "hole 1" — a `viewer` signs in with
their own JWT and calls `viewerClient.rpc('transfer_workspace_ownership',
{ p_workspace_id: <own workspace>, p_new_owner_user_id: <own user id> })`
directly. Before fix: `error` was null and the viewer became owner
(watched fail). After fix: PostgREST returns a permission-denied error
and the owner role is unchanged (watched pass).

**Hole 2 — `remove_workspace_member`.** Mechanism confirmed by reading
supabase/migrations/20260819065751_close_profiles_rls_gaps.sql:109-168:
SECURITY DEFINER, no caller check at all — only validates the target
membership row exists, is active, and (for owners) isn't the sole owner.
Confirmed `lib/actions/workspaces.ts` `removeMember()` (line ~913) is the
only application caller, via `admin.rpc(...)` (service-role), after its
own `requireWorkspaceAdmin()` check. **Fix chosen: (b) revoke the
`authenticated` grant entirely.** Same reasoning as hole 1 — this
confirms the task prompt's suspicion that the grant is pure attack
surface with no legitimate app path needing it.
Test: "hole 2" — a `viewer` calls `remove_workspace_member` on their own
membership id directly. Before: succeeded, row deleted. After: rejected,
row still `active`.

**Hole 3 — `change_workspace_slug_atomic`.** Mechanism confirmed by
reading supabase/migrations/20260905110000_change_workspace_slug_atomic.sql:28-72:
SECURITY DEFINER, no caller check; also `set search_path = public` (no
`pg_temp`), the gap `20260914010000_f006d_authz_gaps.sql:14-21` noticed
but never fixed. Confirmed `lib/actions/workspaces.ts`
`changeWorkspaceSlug()` is the only caller, via `admin.rpc(...)`
(service-role), after its own `requireWorkspaceAdmin()` check. **Fix
chosen: (b) revoke the `authenticated` grant entirely**, plus pin
`search_path = public, pg_temp` (matching the convention established by
20260908010000_pin_pg_temp_on_client_visibility_predicates.sql and every
SECURITY DEFINER function fixed since) via `create or replace function`
with an otherwise byte-identical body.
Test: "hole 3" — a `viewer` calls `change_workspace_slug_atomic` directly
to rename their own workspace's slug. Before: succeeded. After: rejected,
slug unchanged.

**Hole 4 — guest writes workspace-wide vs project-scoped reads.**
Mechanism confirmed by diffing
supabase/migrations/20260821194634_guest_project_scoped_writes.sql (adds
a guest branch scoped to `project_members`) against
supabase/migrations/20260821195500_viewer_write_rls_exclude_guest_fix.sql
(re-creates the same function as `wm.role <> 'viewer'`, silently dropping
that branch), and confirmed the live definition
(20260908010000_pin_pg_temp_on_client_visibility_predicates.sql:69-104,
`wm.role not in ('viewer', 'client')`) still has the wider, ungated
behaviour — `is_project_workspace_writer`/`is_task_workspace_writer` are
the last-defined versions of these names (grepped every
`create or replace function public.is_project_workspace_writer` across
supabase/migrations/, 20260908010000 is the last hit). Checked for later
dependents on the wider behaviour before narrowing it:
`tests/integration/rls-guest.test.ts` (F134, AS-220..AS-223, AS-237) only
asserts the *positive* case (a guest CAN write inside a project they were
added to); nothing asserts or relies on a guest writing outside an added
project. **Fix chosen: (a) restore the caller-scoping in the function
body** (this is a correctness/RLS-scoping fix, not a grant surface — there
is no grant to revoke; the fix is restoring the dropped `project_members`
branch for `guest`, alongside the `client` exclusion added later by
20260902010000, which this migration does not touch).
Test: "hole 4" — a guest (added to no project) signs in and inserts a
comment on a task in a workspace-visible project they have no
`project_members` row for. Before: succeeded (workspace-wide guest
write). After: rejected by RLS.

**Hole 5 — `generate_unique_project_key`.** Mechanism confirmed by
reading supabase/migrations/20260819061129_project_keys_and_task_numbers.sql:127-163:
SECURITY DEFINER, bypasses `projects` RLS, `grant ... to authenticated,
anon, service_role` at :163, callable with no auth. Confirmed via grep
that no `lib/`/`app/` code calls it through `.rpc()` — its only two
callers are the `assign_project_key()` BEFORE INSERT trigger and the
one-time backfill DO block, both in the same migration file. Confirmed
`assign_project_key()` is itself SECURITY DEFINER
(supabase/migrations/20260819061129_project_keys_and_task_numbers.sql:182-198),
so its internal call to `generate_unique_project_key()` executes as the
function owner regardless of the inserting role's own grants — an
external EXECUTE grant was never required for the trigger path. **Fix
chosen: (b) revoke the `anon` and `authenticated` grants entirely**,
leaving `service_role` (harmless — not reachable via the anon/publishable
key at all).
Test: "hole 5" — an unauthenticated `anon` client calls
`generate_unique_project_key` directly with a workspace id and a
candidate name. Before: succeeded, returning `MKT`/`MKT2`-style output
revealing whether a same-named project exists. After: rejected
(permission denied).

**20261004010000_f016g_default_acl_and_unguarded_functions.sql
interaction**: that migration's `authenticated_fns`/`anon_fns` arrays
re-grant `authenticated`/`anon` to these functions by name via a
`do $$ ... $$` loop keyed off `pg_proc`, run once at apply time — it does
not re-run automatically, so this migration's explicit `revoke`
statements, placed after it in migration order (20261025010000 > 
20261024010000, the latest prior migration), take effect and stay in
effect. Verified via `npm run migrations:check` (no drift) and by
re-running the security test suite after `db:apply`.

**MCP usage**: none required — no MCP row exists for schema
introspection beyond the project's own `scripts/apply-migration.mjs` /
`scripts/check-migration-drift.mjs` tooling, which this repo's convention
already uses for every migration (grepped for precedent in
20261024010000 and earlier F016-series migrations before writing this
one).

## Out-of-scope work needed
None identified beyond what was already flagged as out-of-scope by prior
migrations (e.g. `is_valid_timezone`'s anon grant, noted in
tests/integration/f016i-anon-execute-catalog.test.ts as a pre-existing,
separately-tracked finding — not touched here, unrelated to this audit's
five holes).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: For holes 1-3 and 5, chose grant-revocation (option
b) over an in-body `auth.uid()` check because the only legitimate caller
in every case is the service-role admin client, where `auth.uid()` is
already null — an in-body check keyed on `auth.uid()` would not
distinguish "legitimate service-role call" from "illegitimate direct
authenticated call" any better than the grant revocation does, and the
grant revocation is strictly simpler and stronger (no code path to get
wrong). This matches the explicit steer in the task for hole 2 and I
applied the same reasoning to holes 1, 3, and 5 after confirming (by
grep) that each has the identical call-site shape (single caller, via
`admin.rpc()`/service-role, in `lib/actions/workspaces.ts` or a DB
trigger).

## Notes for the next worker
- The new test file `tests/integration/security-authz-holes.test.ts`
  intentionally calls RPCs and table writes through a real signed-in
  user's own JWT (`createClient(url, PUBLISHABLE_KEY)` +
  `signInWithPassword`), never the service-role admin client — this is
  what makes it reproduce the actual PostgREST-reachable holes rather
  than re-testing the app-layer checks the existing
  transfer-ownership.test.ts / remove-member.test.ts / change-workspace-slug.test.ts
  suites already cover (those all mock `@/lib/supabase/server` and call
  the Server Actions directly, which never exercised the raw grant
  surface).
- Ran the full sequence "watch it fail, then fix, then watch it pass" for
  all five holes in one file (five `it` blocks) rather than five separate
  files, since they share the same seeding helpers; each is independently
  failable (no assertion in one depends on another passing).
- Did not touch `lib/queries/approvals.ts`, `components/portal/*`,
  project settings pages, `components/nav/app-sidebar.tsx`, or realtime
  subscribe modules, per the concurrent-editing note.
- Migration filename `20261025010000` was deliberately chosen to sort
  after the current latest migration (`20261024010000`) so this
  migration's revokes are not shadowed by 20261004010000's grant-restore
  loop, which only runs at its own apply time and does not re-execute.
