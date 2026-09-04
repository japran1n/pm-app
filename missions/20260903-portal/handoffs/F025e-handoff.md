# Handoff: F025e — Three portal reads guarded once, and a sweep leg switched off by a stale comment

## Status
COMPLETE

## Assertions covered
AS-049: PASS — `getClientVisiblePortalLinks` (new, lib/queries/project-site.ts) applies `.eq("client_visible", true)` explicitly; f023-site-view-render.test.ts now calls this production function directly and a companion test proves it fails (leaks the hidden link) when the filter is neutered.
AS-050: PASS — `getClientVisiblePortalAccounts` (new, lib/queries/project-site.ts) applies `.eq("client_visible", true)` explicitly; same production-function-call + filter-removed-fails pattern as AS-049.
AS-051: PASS — `getClientVisibleDocs` (new, lib/queries/docs.ts) applies `.eq("client_visible", true)` explicitly; f023-site-view-render.test.ts calls it directly and a companion test proves it fails when the filter is neutered.
AS-054: PASS — f025-portal-table-triple-sweep.test.ts's `docs` fixture now has a real `rpc` leg (`getClientVisibleDocs`) instead of `rpc: null`; a new anti-staleness test (`NULL_RPC_ALLOWLIST`) fails the suite if any fixture's `rpc` is null without an explicit, reasoned allowlist entry, catching the exact "quietly stopped covering a table" failure mode this feature called out.

## Files changed
lib/queries/docs.ts
lib/queries/project-site.ts
app/(portal)/portal/[workspaceSlug]/p/[projectId]/site/page.tsx
components/portal/project-links-list.tsx
components/portal/project-accounts-table.tsx
tests/integration/f023-site-view-render.test.ts
tests/integration/f025-portal-table-triple-sweep.test.ts
tests/integration/f025e-guard-hardening.test.ts (new)
supabase/migrations/20261023010000_f025e_credential_guard_execute_grant.sql (new)

## Commands run
`npm run db:apply -- supabase/migrations/20261023010000_f025e_credential_guard_execute_grant.sql` (0)
`npm run db:gen-types` (0, no diff in lib/supabase/database.types.ts — a GRANT doesn't change the generated schema types)
`npx vitest run tests/integration/f025e-guard-hardening.test.ts tests/integration/f023-site-view-render.test.ts tests/integration/f025-portal-table-triple-sweep.test.ts` (0, 23 tests passed)
`npx vitest run tests/integration/f022-links-accounts-docs-visibility-rls.test.ts` (0, 27 tests passed — side-effect verification per Definition of Done)
`npx tsc --noEmit` (0)
`npx eslint <all changed files>` (0, no errors)

## Decisions made
- **Did not add the `client_visible` filter directly to `getProjectLinks`/`getProjectAccounts`.** Grepped their only other caller (`app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/site/page.tsx:62-63`) and found it is the TEAM settings panel that must show every row, including hidden ones, so a team member can toggle visibility. Filtering those two functions directly would have broken that page silently (hidden links/accounts would vanish from the management UI, not just the portal). Instead added two new sibling functions, `getClientVisiblePortalLinks`/`getClientVisiblePortalAccounts`, each applying the explicit `.eq("client_visible", true)` and doc-string-linked to the file header explaining the split. The portal's site page (`app/(portal).../site/page.tsx`) now calls only the new pair; the settings page is untouched and still calls the original unfiltered pair.
- **Did not add the filter directly to `getAllDocs` either**, for the same reason: grepped its callers and found two workspace-internal docs pages (`app/(workspace)/.../docs/layout.tsx` ×2) that need every doc, filtered or not, for team editing. Added `getClientVisibleDocs` as the portal-only sibling in `lib/queries/docs.ts`, following the exact `docsBaseQuery`/`applyScope` pattern already in that file. `app/(portal).../site/page.tsx` now calls this new function; the two workspace docs pages are untouched.
- **Updated the sweep's `project_links`/`project_accounts` RPC legs to the new `getClientVisiblePortalLinks`/`getClientVisiblePortalAccounts` functions**, not left pointing at the now-unfiltered `getProjectLinks`/`getProjectAccounts` — those would have started failing (leaking the hidden marker) the moment the filter moved to the new wrapper functions, since the sweep's whole point is proving the RPC leg the portal actually calls doesn't leak.
- **"Filter removed" failure tests use a prototype-level `.eq()` patch, not a hand-edited copy of the production function.** `withClientVisibleFilterRemoved()` in f023-site-view-render.test.ts temporarily monkey-patches `PostgrestFilterBuilder.prototype.eq` (all three tables share this one class from `@supabase/postgrest-js`) so any call `.eq("client_visible", true)` becomes a no-op, runs the real production function through the mocked `createClient()` using the SERVICE-ROLE client (RLS itself would otherwise still hide the row from a client caller, masking whether the app-level filter did anything), asserts the hidden row now leaks, then restores the prototype. This proves the AS-049/050/051 tests actually exercise the filter rather than being vacuously true regardless of it.
- **AS-054 anti-staleness fix is a `NULL_RPC_ALLOWLIST`, not a hard "every fixture must have an rpc" rule.** `tasks`' fixture legitimately has `rpc: null` (documented: its RPC layer is covered elsewhere, by f005-portal-pages.test.ts / f003-portal-shell.test.ts). A blanket "rpc must be non-null" rule would have forced a redundant RPC leg there. Instead any `rpc: null` fixture must have a reasoned entry in `NULL_RPC_ALLOWLIST`, and the check runs in both directions — it also fails if an allowlisted table's fixture later gains a real `rpc` (a stale allowlist entry), forcing whoever changes either side to keep them in sync.
- **`looks_like_credential` gets `authenticated` EXECUTE only, not `anon`.** Every write path requires a signed-in session already (no anonymous write path exists on `project_accounts`/`project_links`), so widening to `anon` would be an unjustified grant. The new catalog test in f025e-guard-hardening.test.ts asserts both directions (`authenticated_exec === true`, `anon_exec === false`).
- **Manual-verification test for item 4a uses a real authenticated insert**, not a mocked permission check: an `owner`-role session inserts a credential-shaped `service` value into `project_accounts` and the test asserts SQLSTATE `23514` (check_violation), not `42501` (insufficient_privilege) or a "permission denied" message substring — the exact distinction the missing grant would have collapsed.
- **`security_invoker` assertion reads `pg_class.reloptions` via the Management API**, not `information_schema.views` (Postgres doesn't expose `security_invoker` through the SQL-standard information_schema view; it's a reloption on the view's `pg_class` row, materialized as the string `security_invoker=true`).

## Out-of-scope work needed
None identified beyond this feature's own scope. The team settings "Site" panel (`settings/site/page.tsx`) correctly keeps using the unfiltered `getProjectLinks`/`getProjectAccounts` — not a gap, a deliberate split documented in `lib/queries/project-site.ts`'s file header.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose new sibling functions (`getClientVisiblePortalLinks`/`getClientVisiblePortalAccounts`/`getClientVisibleDocs`) over adding the filter to the existing three functions named in the spec's Finding 1, because grepping actual callers showed the existing functions are shared with team-facing pages that need unfiltered rows. The spec's own wording ("or a client-facing wrapper") for `getAllDocs` explicitly allowed this; I applied the same reasoning to `getProjectLinks`/`getProjectAccounts` for consistency and because a silent behavior change to a team management page would have been a worse outcome than the finding it was meant to fix.
AUTONOMOUS_DECISION: `NULL_RPC_ALLOWLIST` mechanism (rather than a stricter or looser anti-staleness check) chosen to satisfy the spec's "add whatever makes a stale fixture visible" instruction while preserving `tasks`' legitimate `rpc: null` without forcing a redundant RPC wiring.

## Notes for the next worker
- `lib/queries/project-site.ts` and `lib/queries/docs.ts` now each carry both an unfiltered pair (team-facing) and a client-visible-filtered pair (portal-facing). If a new portal page needs links/accounts/docs, use the `getClientVisible*` functions, never the unfiltered ones directly against a client-reachable route.
- The `withClientVisibleFilterRemoved()` helper in `tests/integration/f023-site-view-render.test.ts` is a reusable pattern (prototype-patch a shared postgrest-js builder method) for proving a query function's filter is load-bearing without duplicating its SQL inline. Consider extracting it to a shared test helper if a future feature needs the same proof for another guarded query.
- No MCP tools were used (Supabase MCP is not authorised for this mission per the task instructions); schema introspection and migration application went through the Supabase Management API (`mgmtSql` helper, same pattern already established in `tests/integration/f025-portal-table-triple-sweep.test.ts`) and the CLI (`npm run db:apply`).
