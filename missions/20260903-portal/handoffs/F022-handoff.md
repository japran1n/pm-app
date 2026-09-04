# Handoff: F022 — Migration + team UI: links, accounts, doc visibility

## Status
COMPLETE

## Assertions covered
AS-049: PASS — `project_links` holds `kind` (closed enum: staging/live/figma/sitemap/drive/webflow/gtm/analytics/search_console/other), `label`, `url`, and `client_visible` defaulting false. Live test (`tests/integration/f022-links-accounts-docs-visibility-rls.test.ts`, "AS-049" describe block, 7 tests) proves: a bad `kind` is rejected by the CHECK, a link inserted without an explicit `client_visible` defaults to false, a client on a portal-enabled project reads only the `client_visible = true` link (by list and by direct id), a team member reads both, a client has no INSERT/UPDATE/DELETE path, and a portal-disabled project's client-visible link is still invisible to its client.
AS-050: PASS — `project_accounts` holds `service`, `owner` (client/agency), `status` (pending/provisioned/transferred), `renewal_date`, `note`, `client_visible` defaulting true. Live test ("AS-050" describe block, 11 tests) proves: bad `owner`/`status` values are rejected by their CHECKs, a value shaped like a Stripe secret key, a GitHub PAT, a Slack bot token, a PEM header, or a long base64-ish run is rejected by the CHECK on both `service` and `note` (4 shapes × 2 columns = 8 parameterised tests), an ordinary service name/note is accepted, a client reads owner/status, a hidden account is absent from a client's select, and a client has no write path. Unit test (`tests/unit/f022-project-accounts-credential-guard.test.ts`, 12 tests) covers the matching Zod refinement: same 6 shapes rejected, an ordinary short tool name and an ordinary handover note are NOT flagged (the "does not gold-plate" requirement), and the schema's error message names the password manager.
AS-051: PASS — `docs.client_visible` (default false) and `docs.doc_kind` (note/training/process/handover, default 'note'). Live test ("AS-051" describe block, 8 tests) proves: a bad `doc_kind` is rejected by the CHECK, a client on a portal-enabled project reads only the client-visible doc with its kind (by list and absent by direct id for the hidden one), a portal-disabled project's client-visible doc is still invisible, a workspace-level doc (`project_id is null`) is never reachable by a client even if flagged `client_visible`, a team member still reads every doc regardless of `client_visible` (proves the pre-existing team policies from 20260905020000/20260905030000 are unchanged), and a client has no write path to either column.

## Files changed
supabase/migrations/20261014010000_f022_links_accounts_docs_visibility.sql
supabase/migrations/20261014020000_f022b_credential_guard_underscore_fix.sql
lib/queries/project-site.ts
lib/validation/project-site.ts
lib/actions/project-site.ts
lib/actions/docs.ts
lib/queries/docs.ts
components/docs/doc-client-visibility-toggle.tsx
components/docs/markdown-editor.tsx
components/project/site-panel.tsx
components/project/project-settings-nav.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/site/page.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/docs/[docId]/page.tsx
tests/integration/f022-links-accounts-docs-visibility-rls.test.ts
tests/unit/f022-project-accounts-credential-guard.test.ts
lib/supabase/database.types.ts (regenerated)

## Commands run
`npm run db:apply -- supabase/migrations/20261014010000_f022_links_accounts_docs_visibility.sql` (0)
`npm run db:apply -- supabase/migrations/20261014020000_f022b_credential_guard_underscore_fix.sql` (0 — see Decisions made: fixes an underscore gap in the secret-shape regex the unit test caught before this feature's own commit)
`npm run db:gen-types` (0)
`npm run migrations:check` (0, no drift)
`npx tsc --noEmit` (0)
`npx eslint lib/queries/project-site.ts lib/validation/project-site.ts lib/actions/project-site.ts lib/actions/docs.ts lib/queries/docs.ts components/docs/doc-client-visibility-toggle.tsx components/docs/markdown-editor.tsx components/project/site-panel.tsx components/project/project-settings-nav.tsx "app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/site/page.tsx" "app/(workspace)/w/[workspaceSlug]/projects/[projectId]/docs/[docId]/page.tsx" tests/integration/f022-links-accounts-docs-visibility-rls.test.ts tests/unit/f022-project-accounts-credential-guard.test.ts` (0 errors, 0 warnings)
`npx vitest run tests/unit/f022-project-accounts-credential-guard.test.ts` (0, 12/12 passing)
`npx vitest run tests/integration/f022-links-accounts-docs-visibility-rls.test.ts` (0, 27/27 passing against the live Supabase project)
`npx vitest run tests/integration/docs-rls.test.ts tests/integration/f016l-public-table-rls-catalog.test.ts tests/integration/f016i-anon-execute-catalog.test.ts` (0, 24/24 passing — side-effect verification: the existing docs RLS suite is unchanged and green, and the two new tables/one new function have RLS enabled and no anon EXECUTE leak)
Full vitest suite deliberately NOT run, per instructions.

## Decisions made
- **`project_accounts` has no column literally named `label`.** The spec's own text says "Add a CHECK on `note` and `label`", but section 2's explicit column list for `project_accounts` (id, project_id, service, owner, status, renewal_date, note, client_visible, position) never names a `label` column — `project_links` has one, `project_accounts` does not. Applied the guard to the two free-text columns `project_accounts` actually has: `service` and `note`. Documented this reading in the migration's own header comment rather than silently inventing a `label` column that would duplicate `service`.
- **One shared `public.looks_like_credential(text)` SQL function** backs both `project_accounts_service_no_secret_shape` and `project_accounts_note_no_secret_shape`, rather than duplicating the six-pattern regex twice inline — one source of truth for what "looks like a credential" means at the database layer, matching the migration's own comment. Not SECURITY DEFINER (touches no table), so it needed no `search_path` pin and no manual grant/revoke — F016i's event trigger sweeps its anon EXECUTE automatically on `CREATE FUNCTION`, confirmed via `f016i-anon-execute-catalog.test.ts` passing unchanged.
- **A follow-up migration (`20261014020000_f022b_...`), not an edit to the first one.** The unit test I wrote for the Zod refinement caught a real gap before commit: a genuine Stripe key shape (`sk_live_51H8x9yz...`) uses an underscore after the `live_`/`test_` segment, which the original `[a-z0-9]{10,}` alnum-only run didn't span, so a real secret key would have slipped through both the CHECK and the refinement. Since `20261014010000` was already applied to the live project before the unit test ran, editing that file in place would have silently no-op'd on re-apply (the F020 handoff's own documented gotcha: `db:apply` matches by filename version prefix, not content). Fixed via a second `create or replace function` migration instead, and widened the matching JS regex in the same commit so the CHECK and the Zod refinement never drift apart again.
- **Reorder is a two-row position swap, not an RPC** — same as `reorderPhases` (`lib/actions/phases.ts`, grep-verified: `20260909010000`'s own migration and F002's handoff establish this pattern; no RPC exists for phase reordering either). Design constraint 6 ("multi-table writes go through an RPC") is about writes spanning multiple *tables* in one transaction (`accept_client_request_atomic`, `approve_portal_task_atomic`); a swap of two rows within the same table, executed as two independent `ctx.admin` updates with the second write's failure surfaced as a generic error (server-authoritative, optimistic-with-reconciliation on the client, exactly `phase-list.tsx`'s own shape), is not that.
- **The doc kind selector and client-visibility toggle render only for a project-scoped doc** (`projectId` prop present), same gating `RequestApprovalDialog` already uses in this file for the same reason: `docs_select_client` requires `project_id is not null` (a client's portal is always scoped to one project), so a workspace-level doc has no client audience these controls could ever affect.
- **`docs_select_client` is a new, additive policy — no existing docs policy was dropped or redefined.** Verified live: `docs-rls.test.ts` (the pre-existing suite covering 20260905020000/20260905030000's own leak fix) passes unchanged, and this feature's own "a team member still reads every doc regardless of `client_visible`" test proves the team read path is untouched.
- **`setDocClientVisibility`/`setDocKind` go through the plain RLS-respecting `createClient()`**, not an admin client with a manual re-check — matching every other action in `lib/actions/docs.ts` (`updateDoc`, `moveDoc`, etc.), whose own header comment states the file's convention explicitly: RLS (`docs_update_active_members`, unchanged by this feature) is the enforcement boundary, not a second authorization layer in the action. This is a deliberate deviation from `lib/actions/project-site.ts`'s own `withAuthz` + admin-client pattern (mirroring `project-records.ts`) — two different existing conventions for two different existing files, each kept consistent with its own file rather than forcing one convention onto both.

## Out-of-scope work needed
- F023 (Portal: Your site view, AS-049/050/051) needs to build the actual client-facing page reading `getProjectLinks`/`getProjectAccounts` (both exported from `lib/queries/project-site.ts` specifically for this) and the portal's "guides" list reading `docs` filtered to `client_visible = true` (RLS already does this filtering for a client caller; no query helper for the portal-side docs list exists yet — not built here, per this feature's own scope, which is migration + team UI only).
- F024 (Client preview mode) and F025 (Leak sweep) will want to add `project_links`/`project_accounts`/`docs`-with-`client_visible` to whatever route-walk or catalog check they build — this feature's own tests already establish the three-table leak-test shape (list, direct-id, portal-disabled-project) they can extend rather than reinvent.
- Not discovered here, but noted in passing: `lib/queries/approvals.ts` also selects from `docs` (for the "Request client approval" subject list) without the two new columns — out of scope for this feature (it doesn't need them; that list is a team-only, not client-facing, read), flagged only in case a future feature wants doc kind/visibility surfaced there too.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Applied the secret-shape CHECK to `project_accounts.service`/`project_accounts.note` instead of a nonexistent `label` column, per the spec's own explicit per-table column list overriding its shorter prose reference — see "Decisions made" above.
AUTONOMOUS_DECISION: Chose the swap-with-neighbor reorder shape (mirroring `reorderPhases`) over building a new RPC, since design constraint 6 governs multi-table writes and this is single-table.
AUTONOMOUS_DECISION: Gated the doc header's new controls on `projectId` being present, matching the existing `RequestApprovalDialog` gate in the same file, since a workspace-level doc has no client audience.

## Notes for the next worker
- No MCP tools were used — the Supabase MCP is not authorised for this mission's workers (repeated instruction, also in `worker-mcp-usage`); all schema work went through `npm run db:apply`/`npm run db:gen-types` against the CLI-linked project, and RLS verification used the same live-signed-session integration-test technique every other migration feature in this mission uses.
- **Environment note, not a code defect:** partway through this session another worker process was committing changes to the same working tree concurrently (F021c, migration `20261015010000`). A `git add` of only this feature's own files at one point produced a diff that included that worker's unrelated files, and moments later those same files had already been committed by the other process without my involvement. Handled by re-running `git add` with the exact same explicit file list immediately before this feature's own commit, which by then staged only this feature's files (confirmed via `git status --short` before running `git commit`). The resulting commit (`ecbac6f`) contains only the fifteen files this feature actually changed, nothing from F021c. Worth knowing if a future worker sees files appear/disappear from `git status` unexpectedly in this repo: it may be a concurrent worker, not local corruption — always re-check `git status --short` immediately before `git add`/`git commit`, not earlier in the session.
- The credential-guard regex fix (`20261014020000`) is a good example of why writing the unit test from the assertion text (AS-050's "no field... accepts a credential value") rather than from the implementation caught a real gap: the original patterns were written by eye against the four named shapes in the spec, and only a real Stripe-key-shaped test string (not a synthetic `sk_` + random alnum) surfaced the underscore gap.
