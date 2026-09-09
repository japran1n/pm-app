# Handoff: F024 — Replace tautological isolation tests with real-DB ones

## Status
COMPLETE

## Assertions covered
AS-008: PASS — tests/integration/get-current-doc-isolation.test.ts proves a caller in workspace A gets the identical "not_found" empty shape for a real document that exists only in workspace B (RLS denial, not a filtered mock). Ran against the live linked Supabase project.
AS-023: PASS — tests/integration/search-docs-isolation.test.ts proves searching a unique token that exists only inside a real document in workspace B returns zero results for a caller who is an active member of workspace A only.
AS-024: PASS — tests/integration/list-doc-templates-isolation.test.ts proves a real `kind='doc'` template that exists only in workspace B never appears (by id or name) to a caller who is an active, non-guest member of workspace A only.
AS-028 (isolation clause): PASS — covered by the same list-doc-templates-isolation.test.ts (the mocked malformed-payload/no-results cases in the unit test file continue to cover AS-028's non-isolation "parse defensively" clause; the isolation-specific claim that used to ride along with AS-028 in the mocked test's comment is now only made by the integration test).
AS-002: PASS — proven by both search-docs-isolation.test.ts (docs table) and list-doc-templates-isolation.test.ts (task_templates table): both tools use the RLS-scoped session client exclusively (no `.eq("workspace_id", ...)` filter, no service-role client), and the live database denies cross-workspace reads for both.

## Files changed
tests/integration/get-current-doc-isolation.test.ts (new)
tests/integration/search-docs-isolation.test.ts (new)
tests/integration/list-doc-templates-isolation.test.ts (new)
lib/ai/tools/__tests__/get-current-doc.test.ts (renamed/de-clawed the isolation-claiming case; header comment updated)
lib/ai/tools/__tests__/search-docs.test.ts (renamed/de-clawed the isolation-claiming case, removed the meaningless "not_match(/foreign/)" assertion; header comment updated)
lib/ai/tools/__tests__/list-doc-templates.test.ts (renamed/de-clawed the isolation-claiming case, removed the meaningless "not_match(/foreign/)" assertion; header comment updated)

## Commands run
`npx tsc --noEmit` (1, but only the 4 pre-existing documented errors: app/layout.tsx LayoutProps, components/ui/status-badge.tsx overload, tests/unit/docs-markdown-editor-export-import.test.tsx x2 — none in files this feature touched)
`npx eslint .` (0 errors; 26 pre-existing warnings, same set as documented, none new)
`npx vitest run lib/` (0) — 70/70 passed
`npx vitest run tests/integration/get-current-doc-isolation.test.ts tests/integration/search-docs-isolation.test.ts tests/integration/list-doc-templates-isolation.test.ts` (0) — 3/3 passed, against the live remote Supabase project
`git commit` (0)

## Decisions made
- Placed the three new tests in `tests/integration/` per the spec — this is the legitimate case for that directory: these tests genuinely require a live database and cannot be meaningfully expressed as mocks. Recorded explicitly here as instructed.
- Followed `tests/integration/palette-search-private-project-leak.test.ts`'s pattern exactly: `.env` loader, `haveAdminCreds`/`describe.skipIf`, admin client for seeding via `SUPABASE_SECRET_KEY`, `vi.mock("@/lib/supabase/server")` returning a module-scope `callerSessionClient` set in `beforeAll` after `signInWithPassword`, and full `afterAll` teardown (delete seeded rows, memberships, workspaces, then `auth.admin.deleteUser` for both users).
- Did NOT use the F126 pooled-identity helper (`tests/helpers/auth.ts`). Its own header explicitly says pooled identities are unsafe for any test that "asserts on a workspace list" or needs "this user has exactly one workspace" — these three tests need two users each with membership in exactly one, *different*, freshly-created workspace (one caller, one foreign-workspace owner), which is precisely the shape the reference file (`palette-search-private-project-leak.test.ts`) also opted out of pooling for. Using dedicated `admin.auth.admin.createUser` + `signInWithPassword` per file, matching the reference implementation, was the correct choice per the helper's own documented boundaries.
- For `list_doc_templates`, made the caller an ACTIVE, NON-GUEST member of workspace A (role: "member") — the RLS policy `task_templates_select_non_guest_members` explicitly excludes guests, so a guest caller would make the test ambiguous about *why* the foreign template is invisible (guest exclusion vs. workspace isolation). Kept the two properties cleanly separated.
- Reused the doc's real column shape from `supabase/migrations/20260904010000_docs_system.sql` (`workspace_id`, `title`, `content`, `created_by`) and the template's real shape from `supabase/migrations/20260822180000_task_templates.sql` + `20260909064152_task_templates_doc_kind.sql` (`kind: "doc"`, `payload` matching `docTemplatePayloadSchema`) so the seeded rows are indistinguishable from real application data, not synthetic shortcuts.
- Stripped, but did not delete, the three tautological mocked cases (`get-current-doc.test.ts:74`, `search-docs.test.ts:106-127`, `list-doc-templates.test.ts:69-90`): renamed away from `test_AS_*` isolation names (since they no longer cover those assertions), rewrote their comments to explicitly disclaim isolation coverage and point at the new integration file, and removed the `expect(serialized).not.toMatch(/foreign|other-workspace/i)` lines from search-docs and list-doc-templates — that assertion was exactly the "asserts a string the test itself wrote does not contain a word the test itself never wrote" pattern B2 called out, and stripping the isolation language from the comment without removing the assertion would have left a misleading residue.

## Out-of-scope work needed
None identified beyond F024's stated scope. (M1c in M1-SCRUTINY.md — `docs_select_active_members` scoping to *every* workspace the user belongs to rather than the *current* one, AS-023/AS-024 — is a separate, already-tracked finding and out of scope for this feature, which is about test truthfulness, not tool behavior. Left untouched.)

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `role: "member"` (not owner/admin) for both the caller and the foreign-workspace owner in all three new tests, since none of the three tools' RLS policies distinguish member/admin/owner roles for SELECT (only active-membership and, for task_templates, non-guest status matter) — using the plainest role that satisfies each policy keeps the tests minimal and avoids implying a role-based property that isn't actually being tested.

## Notes for the next worker
- Proof-of-failure evidence for AS-008 (mandatory per spec): I temporarily edited `lib/ai/tools/get-current-doc.ts` to replace its `createClient` import with a local function that builds a `@supabase/supabase-js` client directly from `SUPABASE_SECRET_KEY` (service-role, bypassing RLS entirely), keeping everything else in the file unchanged. Backed up the original to `/tmp/get-current-doc.ts.bak` first.
  - Ran `npx vitest run tests/integration/get-current-doc-isolation.test.ts` with that change in place.
  - Result: **FAILED** — `AssertionError: expected 'ok' to be 'empty'` at the `expect(result.status).toBe("empty")` line, because the service-role client could now read the foreign workspace's document and returned `status: "ok"` with its real content instead of the RLS-enforced empty result.
  - Immediately reverted with `cp /tmp/get-current-doc.ts.bak lib/ai/tools/get-current-doc.ts`, confirmed `diff` showed zero differences from the pre-edit file, then re-ran the same test to confirm it passed again (it did — see Commands run). `git status` after the whole sequence showed `get-current-doc.ts` as unmodified, confirming the temporary edit never touched the committed diff.
  - Only did this for `get_current_doc`; per the spec, one tool's proof is sufficient ("temporarily point one tool at a service-role client... confirm the new tests FAIL"). The other two tools (`search_docs`, `list_doc_templates`) share the exact same `createClient()` / RLS-only pattern and the exact same reference-file test structure, so the same proof mechanism applies identically to them.
- No MCP tools were used for this feature — it is pure test-code work against an already-migrated, already-verified schema (F005's `db:apply`). No new schema/policy changes were needed or made.
- One transient failure during the initial full three-file run: `Failed to create workspace A: JWT issued at future` on `list-doc-templates-isolation.test.ts` when all three files ran concurrently in the same vitest invocation — almost certainly clock-skew/token-freshness noise from three `admin.auth.admin.createUser`+`signInWithPassword` sequences firing close together, not a bug in the test. Re-ran individually and then together again immediately after; both passed cleanly. Worth knowing if this resurfaces during a full `npm test` run — it is very likely non-deterministic and environmental, not a defect in these tests or the tools under test.
