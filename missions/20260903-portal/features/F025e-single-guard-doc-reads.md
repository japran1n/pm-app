# F025e: Three portal reads guarded once, and a sweep leg switched off by a stale comment

**Milestone:** final remediation
**Estimated worker time:** 2 h
**Opened by:** the final gate's M5 audit

## Finding 1 — the portal's guides, links and accounts rest on RLS alone

`site/page.tsx` calls `getAllDocs`, `getProjectLinks` and
`getProjectAccounts`, none of which applies a `client_visible`
predicate — they are scope-only, and rely entirely on RLS.

Every sibling portal query in this codebase is double-guarded, and one
of them says why in its own comment
(`lib/queries/portal.ts:337-342`): the filter is *"the function's own
contract, applied explicitly rather than left entirely to RLS so it
holds even for a team caller previewing the portal's numbers."*

F022 and F023 chose the other way and documented the omission. Today the
exposure is bounded — the portal layout redirects non-clients out, and
F024's preview issues a real client session — so this is not a live
leak. It is three functions whose payload includes a staging URL and an
account ledger, standing on a single guard where the house style stands
on two.

**And the tests that claim AS-049, AS-050 and AS-051 do not exercise the
production functions.** `f023-site-view-render.test.ts` imports the
components and re-implements the query inline with its own select
string. If `getAllDocs` regressed, or `site/page.tsx` swapped in a
different query, those tests stay green. That is the ninth vacuous test
in this mission and a familiar species: a test that proves a
reimplementation rather than the code.

## Finding 2 — the AS-054 sweep skips `docs` on purpose, for a reason that expired

`f025-portal-table-triple-sweep.test.ts` sets `docs.rpc = null` with the
comment *"No dedicated client-facing list docs query function exists
yet"*. That was true when F025 was written. F023 then made `getAllDocs`
exactly that function.

So the one covered table whose production query lacks its own
`client_visible` filter is also the one whose third sweep leg is
disabled. AS-054 requires absence "from every RPC response"; for `docs`
that leg is untested. The suite's anti-staleness check only verifies a
fixture *exists* per table — it cannot see that a fixture's `rpc` went
stale.

## Scope

1. Add the explicit `client_visible` filter to the three functions,
   matching the convention and the reasoning already written down in
   `lib/queries/portal.ts`.
2. Point the AS-049/050/051 tests at the production functions instead of
   inline copies. Verify each fails when its filter is removed.
3. Re-enable the `docs` leg of the sweep, and add whatever makes a
   *stale* fixture visible — the existing check catches a missing
   fixture but not a fixture that has quietly stopped covering
   something.
4. Also from the same audit, both small: give `looks_like_credential` an
   explicit `authenticated` EXECUTE grant (F016i's event trigger revoked
   it, and every write today is service-role, so the first
   authenticated write to `project_accounts` would fail with a
   permission error rather than a clean constraint violation); and
   assert `security_invoker` on `client_requests_client_read` from the
   catalog, since a future `create or replace view` could drop the flag
   and the masking would still appear to work.

## Definition of done

- **Primary success test:** each of the three queries excludes a
  non-client-visible row even when called by a team member.
- **Failure tests:** each AS-049/050/051 test fails when its filter is
  removed; the sweep's `docs` leg fails when the filter is removed.
- **Manual verification:** an authenticated-session write to
  `project_accounts` reaches the constraint rather than a permission
  error.
- **Side-effect verification:** F022's, F023's and F025's suites pass.
