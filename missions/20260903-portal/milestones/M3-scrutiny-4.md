# M3 Scrutiny — round 4 (final gate), after F016i / F016j / F016k

Mission: 20260903-portal · Milestone M3 · Reviewed at `f5f0b98`
Read-only: no code, test, migration or contract file modified. Full vitest suite
deliberately not run. All findings verified against the **applied catalog** and
over the live PostgREST endpoint with the anon publishable key.

## VERDICT

**M3 does not pass — one blocker.** Roll back M4 only if you are unwilling to
land a one-migration fix; the blocker is self-contained and does not touch
anything M4 builds on.

## Blocker

**`public.f016i_gated_function_oids` is anon-readable AND anon-writable over
PostgREST, and writing to it disables the F016i gate.**

Applied catalog: it is the **only** table in schema `public` with
`relrowsecurity = false`, zero policies, and `anon` holds
SELECT/INSERT/UPDATE/DELETE. Confirmed over the wire with the anon key:

```
GET  /rest/v1/f016i_gated_function_oids?select=oid&limit=2  -> 200 [{"oid":"19441"},{"oid":"32483"}]
POST /rest/v1/f016i_gated_function_oids {"oid":999999}      -> 201
```

(The probe row was deleted again; DB left as found.)

Both directions are exploitable, and each defeats a thing M3 was built to
guarantee:
- **INSERT** a range of plausible future oids → the trigger's
  `if not exists (select 1 from f016i_gated_function_oids where oid = obj.objid)`
  short-circuits, and every function a future migration creates keeps the
  built-in `EXECUTE TO PUBLIC` grant, i.e. is anon-callable. That is exactly the
  systemic failure F016i was written to close, re-opened through the mechanism's
  own state table.
- **DELETE** all rows → the next `create or replace` of any of the ~100 existing
  functions is treated as a first creation and has its grants stripped, breaking
  the app (the "silently strip preserved grants" failure the migration header
  itself identifies as the thing to avoid).

Fix (one migration): `alter table public.f016i_gated_function_oids enable row
level security;` plus `revoke all on public.f016i_gated_function_oids from anon,
authenticated;` — the table is only ever touched by a SECURITY DEFINER event
trigger function owned by `postgres`, so no policy is needed. Add it to whatever
catalog test asserts "no RLS-less table in public".

## The three questions, answered

**1. Event trigger — works.** Live rolled-back probe:
`create function public.zz_probe_new_fn()` → `proacl =
{postgres=X/postgres,service_role=X/postgres}`, `has_function_privilege('anon',
…) = false`. A pre-existing function granted to anon/authenticated and then
`create or replace`d → ACL preserved verbatim, `anon = true`. So it fires, gates
new functions, and leaves replaces alone.
Ownership: `pg_event_trigger` shows `f016i_revoke_default_execute` owned by
`postgres`; only the owner or a superuser can `ALTER … DISABLE` or `DROP` it —
`anon`/`authenticated` cannot. A function created in a transaction that later
rolls back: the revoke and the oid insert are in the same transaction and roll
back with it, leaving no stale row. Correct.
All ten M3 RPCs remain `authenticated`-executable and `anon`-non-executable in
the applied catalog, so F016i/j/k did not strip anything reachable.

**2. Allow-list guard — genuinely self-maintaining.** Live probe adding
`zz_probe_col` in a rolled-back transaction: the guard's `pg_attribute` /
`pg_attrdef` join picks it up with no edit, ref value `NULL`, so an author
supplying it is rejected. Columns with and without a schema default are handled
the same way (`coalesce(pg_get_expr(...), 'NULL')`) and both fail closed. The
one bypass I looked for — setting `created_by` to another user to skip the
`new.created_by = auth.uid()` branch — is closed by the RLS INSERT policy
`client_requests_insert_own`, whose WITH CHECK pins `created_by = auth.uid()`
and is the only INSERT policy on the table.
*Major (not blocking):* the default row is computed by evaluating the default
expressions live, so a future non-allow-listed column with a **volatile** default
(`now()`, `gen_random_uuid()`) would never equal the freshly-computed reference
and would reject every client insert. Today's volatile-default columns
(`id`, `created_at`, `updated_at`) are all allow-listed, so this is latent, and
it fails closed rather than open.

**3. `waived` respects every gate.** In the applied body of
`accept_deliverable_atomic`, the `auth.uid() is null` check, the row lock, the
not-found check, the `is_project_workspace_writer(v_project_id)` authorisation
and the workspace lookup all run **before** the decision branch, so `waived`
inherits every gate `accepted`/`returned` have; it is not a new write path
around them. It also writes an audit entry (`client_deliverable.waived`). The
Zod schema, the server action's `withAuthz` (requireWrite + requireVisibility)
and the panel's `canWaive` all line up. `sweep_overdue_blocking_deliverables`
excludes `state in ('accepted','waived')` and `clear_client_deliverable_swept_at`
clears on the transition into `waived`, so waiving genuinely stops the blocking
behaviour. No missing-gate instance here.

**4. Regressions from F016i/j/k.** None found beyond the blocker above.
`tsc --noEmit` clean; `npm run lint` 0 errors / 19 pre-existing warnings.
*Minor:* `getDeliverablesPastDueCount` now fetches all rows for the project and
filters in TS — subject to PostgREST's default 1000-row cap, so a project with
>1000 deliverables would undercount the badge.

## Assertion table (deltas only)

| ID | Verdict | Severity | Reason |
|---|---|---|---|
| AS-003 | PASS | — | Badge now calls `isDeliverablePastDue`; both surfaces exercised (row-cap caveat, minor). |
| AS-030 | PASS | — | `waived` is a real action, fully gated; sweep and swept_at trigger both honour it. |
| AS-047 | PASS | — | Allow-list guard self-maintains (live column probe); `created_by` bypass closed by RLS WITH CHECK. |
| — (systemic) | **FAIL** | blocker | `f016i_gated_function_oids`: no RLS, anon SELECT/INSERT/UPDATE/DELETE over PostgREST; writes defeat the F016i gate in both directions. |
| — (systemic) | FAIL | major | Allow-list reference row evaluates defaults live; a future volatile-default column would reject all client inserts. |

## Recommended follow-up (single feature)

**F016l — lock down the F016i gate table.** Enable row level security on
`public.f016i_gated_function_oids` and revoke all table privileges from `anon`
and `authenticated`; the table is written only by the SECURITY DEFINER event
trigger function owned by `postgres`, so no policy is required and nothing in
the app reads it. Extend `tests/integration/f016i-anon-execute-catalog.test.ts`
(or add a sibling) with a catalog-derived assertion that **no** table in schema
`public` has `relrowsecurity = false` and that `anon` holds no INSERT/UPDATE/
DELETE on any `public` table, so the next migration that adds a bookkeeping
table cannot repeat this. Prove it fails by asserting over the wire that an
anon-key POST to that table returns 401/403 rather than 201.
