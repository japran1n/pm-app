# Handoff: F075 — Fix newly-running catalog suite failures now that CI has Supabase secrets

## Status
COMPLETE

## Assertions covered
AS-003: PASS — `check-migration-drift.test.ts` "never includes a credential value in any output" now passes with real CI secrets present.
AS-004: PASS — `check-migration-drift.test.ts` "exits 1 with a plain message when required env vars are missing" now passes with real CI secrets present.
AS-040: PASS (no code change) — `f020b-projects-allowlist-guard.test.ts` "a column added to projects after this migration is protected by default" passes when run alone; failure in run 33857487411 attributed to concurrent-run interference on the shared hosted project (see below), not a guard regression.
AS-383: PASS — `overdue-notification-sweep.test.ts` "notify_overdue_task_assignees" now passes; fixture setup no longer violates the projects field-role guard and teardown no longer corrupts itself on a partial beforeAll failure.

## Files changed
tests/unit/check-migration-drift.test.ts
tests/unit/check-realtime-publication.test.ts
tests/integration/overdue-notification-sweep.test.ts

## Commands run
`npx vitest run tests/unit/check-migration-drift.test.ts tests/unit/check-realtime-publication.test.ts` (0, 30 passed)
`npx vitest run tests/integration/overdue-notification-sweep.test.ts` (0, 9 passed)
`npx vitest run tests/integration/f020b-projects-allowlist-guard.test.ts` (0, 14 passed — full file, run alone)
`npx vitest run tests/integration/f020b-projects-allowlist-guard.test.ts -t "self-maintaining allow-list"` (0, 1 passed, 13 skipped — run alone)
`npx tsc --noEmit` (0)
`gh run view 33855218430 --json status,conclusion,createdAt,updatedAt,name` / `gh run view 33857487411 --json ...` — confirmed the two runs' windows overlap (08:48:31–09:30:55 and 09:16:02–09:29:57 UTC)
`gh run list --limit 5 --json status,name,createdAt` — confirmed no CI run was in flight before the local single-run repro above

## Decisions made

### 1 & 2. check-migration-drift.test.ts (AS-003, AS-004) and check-realtime-publication.test.ts
**Mechanism:** `checkDrift({ accessToken: undefined, projectRef: undefined, ... })` (and the sibling
`checkRealtimePublication` test) relies on a JS destructuring-default-parameter quirk: passing a
property explicitly as `undefined` does NOT override a destructured default — the default
(`accessToken = ACCESS_TOKEN`, where `ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN` captured at
module import) still applies. Before this run, CI had no `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF`
secrets, so `ACCESS_TOKEN`/`PROJECT_REF` were genuinely `undefined` and the tests' intent ("simulate
missing credentials") accidentally matched reality. Now that CI has real secrets, the module-level
constants are truthy, `checkDrift`/`checkRealtimePublication` sail past their `!accessToken ||
!projectRef` early-return, reach the (fully mocked, unconfigured-for-this-case) `spawnSync`/`fetch`
mock, and blow up on `undefined` mock return values — `TypeError: Cannot read properties of undefined
(reading 'error')` and `expected +0 to be 1`.

**Verdict:** test defect, exactly as the task description predicted — the test's premise ("credentials
absent") was never actually enforced by the test itself; it borrowed the ambient environment's state.
**Fix:** changed the three call sites to pass `accessToken: ""`, `projectRef: ""` instead of
`undefined`. An empty string is a real override (destructuring defaults only kick in for `undefined`,
not for other falsy values), so `!accessToken` is still true regardless of what CI's ambient env holds.
This makes the test's outcome independent of whether secrets are configured, in both directions — it
would have caught a real regression before this run too (had CI had secrets, the old form would have
silently never exercised the "missing" branch).

### 3. overdue-notification-sweep.test.ts (AS-383)
**Mechanism, cause:** the `enforce_projects_field_role_allowlist()` guard (F020b/F025c/F025d) fires as
a BEFORE INSERT trigger regardless of RLS/PostgREST — it is bypassed only for `auth.role() =
'service_role'` or an owner/admin workspace member. This suite's `sql()` helper calls the Supabase
Management API's raw-SQL endpoint directly (bypassing PostgREST, per this file's own header comment
about a PostgREST outage during F212's original implementation) with no JWT context, so `auth.role()`
is neither `service_role` nor a workspace member — the guard correctly rejected `beforeAll`'s
INSERT of the archived-project fixture row, which sets `deleted_at` (an owner/admin-gated column, added
to the guard's `v_owner_admin_cols` by this mission, after this test was originally written).
**Verdict: this is the guard working as designed, catching an older test's setup that predates the
guard — not a product bug.** The correct fix is the one the task suggested: make setup act with
owner/admin-equivalent privilege for that one write, not weaken or route around the guard.
**Fix:** prepended `set local request.jwt.claims to '{"role":"service_role"}';` to the one INSERT that
touches `deleted_at`, in the same Management API query string (verified this shares one implicit
transaction with the following `insert ... returning id` — the test passes and returns the row). This
mirrors the exact technique `f020b-projects-allowlist-guard.test.ts` and
`f016j-client-requests-allowlist-guard.test.ts` already use to simulate roles via
`set local request.jwt.claims`/`set local role`, so it isn't a new pattern in this test suite family;
it grants this one fixture-setup statement the same privilege the app's real service-role admin client
already has for the same kind of write — not a new hole.

**Mechanism, effect (the "undefined" UUID delete):** because the INSERT above threw, `beforeAll` never
reached `archivedProjectId = archivedProj.id`, leaving it `undefined`. `afterAll` still ran (Vitest runs
registered hooks even after `beforeAll` throws) and interpolated the bare JS `undefined` into
`... project_id in ('...', '${archivedProjectId}')`, producing the literal text `'undefined'`, which
Postgres correctly rejected as an invalid UUID (`22P02`) — aborting that DELETE and every teardown
statement after it in the same catch path, i.e. a defect independent of the guard, on its own.
**Fix:** teardown now filters `[projectId, archivedProjectId]` / `[assigneeUserId, optedOutUserId]` /
`workspaceId` for truthiness before building each DELETE, and skips a delete entirely if nothing valid
exists for it. This makes teardown a safe no-op for whichever fixture rows never got created, rather
than corrupting its own cleanup query.

### 4. f020b-projects-allowlist-guard.test.ts (AS-040) — no code change
**Mechanism investigated:** the failing assertion (`GUARD_DID_NOT_FIRE` raised instead of the expected
`42501`) comes from a `do $probe$` block that does `alter table public.projects add column if not
exists f020b_probe_never_committed text;` then attempts to write it as a non-owner and expects `42501`,
inside a transaction it deliberately aborts via `raise exception 'ROLLBACK_PROBE_TRANSACTION'` at the
end (so the added column is never actually committed). Two CI runs (33857487411, created
2026-09-04T09:16:02Z–09:29:57Z, and a rerun of 33855218430, created 2026-09-04T08:48:31Z–09:30:55Z)
were confirmed via `gh run view --json createdAt,updatedAt` to have overlapping execution windows
against the same real hosted project, both running this identical `add column if not exists` /
rollback probe concurrently on the shared `public.projects` table.
**Verdict: concurrency interference between two simultaneous CI runs against the same live project,
not a hole in the guard.** Ran the full file, then the single "self-maintaining allow-list" test in
isolation, confirmed via `gh run list` that no other CI run was in flight at the time — both passed
cleanly (14/14, then 1/1). A `column already exists` race (one run's uncommitted probe column briefly
visible to, or interfering with, the other run's own `add column if not exists` + default-value diff
computation, which reads `pg_attrdef` for the live catalog state) is the most plausible mechanism: the
guard's INSERT-path diff logic re-reads `pg_attrdef`/`to_jsonb` against the *current* schema on every
invocation, so a concurrent DDL change to the same table from a second session can plausibly change
what "default" means mid-probe. A clean, single-run repro (this session's isolated run, verified no
concurrent CI) shows the guard firing correctly. I could not fully prove the exact catalog-level
interleaving (no visibility into the other run's live transaction), but the concurrency confound is
directly evidenced by the two runs' overlapping timestamps and by this test's own 100% pass rate when
run alone, twice.

## Out-of-scope work needed
The self-maintaining `f020b-projects-allowlist-guard.test.ts` probe test mutates the real hosted
project's `public.projects` table via `alter table ... add column`/rollback while other CI runs can be
executing concurrently against the same project. This is a preexisting flakiness risk independent of
this fix: any two CI runs overlapping in time can hit this same interference. A follow-up should either
(a) serialize CI runs against the shared hosted project (e.g. a GitHub Actions concurrency group keyed
on the environment), or (b) make this specific probe more robant to concurrent schema changes (e.g. a
run-unique probe column name, `f020b_probe_${run_id}`, instead of the fixed
`f020b_probe_never_committed`, so two concurrent runs never contend for the same column).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: For the overdue-notification-sweep.test.ts fix, chose "grant the fixture INSERT
service-role-equivalent privilege for that one statement" over "insert without deleted_at, then update
it as owner/admin afterward" — the former is a strict subset of what the guard already permits
(service_role bypass, exercised elsewhere in this same file's sibling suites) and requires no new
workspace-owner fixture user; the task description explicitly named this as an acceptable resolution
path ("fix the test's setup to act as an owner/admin... or to not touch guarded columns").

AUTONOMOUS_DECISION: Did not modify anything for the f020b concurrency-suspected failure, per the task
instruction to report rather than guess if the mechanism can't be fully proven from the log alone. The
isolated-run repro (passing cleanly, twice) combined with confirmed overlapping CI windows is treated as
sufficient evidence for "interference, not regression" without further hammering the real project.

## Notes for the next worker
- `tests/unit/check-migration-drift.test.ts` and `tests/unit/check-realtime-publication.test.ts` are
  pure-mock unit tests — no live Supabase calls, safe to run freely and repeatedly.
- `tests/integration/overdue-notification-sweep.test.ts` and
  `tests/integration/f020b-projects-allowlist-guard.test.ts` write to the real hosted Supabase project
  via the Management API. Each was run only as many times as needed to confirm the fix (twice for
  overdue-notification-sweep including the pre-teardown-fix pass that already succeeded; twice for
  f020b, once full-file and once single-test, both confirming no concurrent CI was running).
- `reaction-realtime-delivery.test.ts` AS-369 (the fifth failure) was explicitly out of scope for this
  feature and was not touched.
