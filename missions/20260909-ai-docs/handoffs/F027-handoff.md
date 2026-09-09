# Handoff: F027 — Scope tools to the current workspace

## Status
COMPLETE

## Assertions covered
AS-023: PASS — `search_docs` now filters `.eq("workspace_id", workspaceId)`; real-DB test proves a caller active in BOTH workspace A and B, calling with A current, gets no results for a token that exists only in B's doc.
AS-024: PASS — `list_doc_templates` now filters `.eq("workspace_id", workspaceId)`; real-DB test proves the same dual-membership case for doc templates.
AS-021 (must not regress): PASS — `get_current_doc` collapses the new "doc belongs to a different workspace" case into the identical `{status:"empty", reason:"not_found", message:"No matching document found."}` shape as every other invisible-doc case; unit test `test_F027_doc_belongs_to_a_different_workspace_than_the_caller_current_returns_the_identical_not_found_shape` and real-DB test `test AS-021: ... even though the caller is also an active member of B` both assert byte-identical output and no leaked content.
AS-028: PASS — `lib/ai/tools/__tests__/list-doc-templates.test.ts` malformed-payload tests (`test_AS_028_*`) still pass unchanged; the new `.eq("workspace_id", ...)` filter doesn't touch payload parsing.

## Files changed
lib/ai/tools/search-docs.ts
lib/ai/tools/list-doc-templates.ts
lib/ai/tools/get-current-doc.ts
lib/ai/docs-agent.ts
app/api/ai/docs/route.ts
lib/ai/tools/__tests__/search-docs.test.ts
lib/ai/tools/__tests__/list-doc-templates.test.ts
lib/ai/tools/__tests__/get-current-doc.test.ts
tests/integration/search-docs-isolation.test.ts
tests/integration/list-doc-templates-isolation.test.ts
tests/integration/get-current-doc-isolation.test.ts
tests/integration/f007-docs-agent-route.test.ts

## Commands run
`npx vitest run lib/` (0) — 75/75 passed (was 74/74; +1 new AS-021 unit test)
`npx vitest run tests/integration/f007-docs-agent-route.test.ts` (0) — 13/13 passed (was 12; +1 new 403 test)
`npx vitest run tests/integration/search-docs-isolation.test.ts tests/integration/list-doc-templates-isolation.test.ts tests/integration/get-current-doc-isolation.test.ts` (0) — 6/6 passed against the real linked Supabase project
`npx tsc --noEmit` (0 relevant) — same 4 pre-existing errors (`app/layout.tsx`, `components/ui/status-badge.tsx`, `tests/unit/docs-markdown-editor-export-import.test.tsx` x2), zero new
`npx eslint .` (0 relevant) — 26 warnings, matching documented baseline (fixed one incidental new warning I introduced in a test mock, `_args` unused, before finishing)

### Proof-of-failure evidence (pre-fix, required by spec)
Stashed the three tool source files only (`git stash push -- lib/ai/tools/get-current-doc.ts lib/ai/tools/list-doc-templates.ts lib/ai/tools/search-docs.ts`), keeping the new/edited tests, then ran:
`npx vitest run tests/integration/search-docs-isolation.test.ts tests/integration/list-doc-templates-isolation.test.ts tests/integration/get-current-doc-isolation.test.ts -t "F027"`
Result: **3 failed / 3 skipped** (the 3 pre-existing F024 "stranger" tests were filtered out by `-t`, the 3 new F027 dual-membership tests all failed as expected):
- search_docs: got `status: "ok"` (workspace B's doc leaked through), expected `"empty"`.
- list_doc_templates: got `status: "ok"` (workspace B's template leaked through), expected `"empty"`.
- get_current_doc: got the full workspace-B document content back (`status: "ok"`, `markdown: "This content must never leak..."`), expected the identical not_found empty shape.
Then `git stash pop` restored the fix and re-ran the same three files (no `-t` filter): **6/6 passed**.

One bug found and fixed during this proof-of-failure pass: my first draft of the new `list_doc_templates` test seeded its payload with `folderHint: null`, which fails `docTemplatePayloadSchema`'s `.optional()` (rejects `null`, only accepts `undefined`) — this made the pre-fix run come back "empty" for the WRONG reason (payload parse failure, not RLS), an unfalsifiable guard exactly like the ones this mission has already rejected three times. Fixed by omitting `tone`/`folderHint` from the seeded payload entirely so the pre-fix run genuinely surfaces the leaked row.

## Decisions made
- `workspaceId` is threaded into each tool's `run(input, workspaceId)` as a second, non-Zod-schema argument — never part of the model-controlled `inputSchema` — so the model can never spoof it. `lib/ai/docs-agent.ts`'s `forRunner` closes over it per request when building the tools array (now `buildDocsAgentTools(workspaceId)`, built fresh per request instead of a module-level constant, since each request's tool closures now carry a different `workspaceId`; tool names/order/schemas are unchanged, so prompt caching is unaffected).
- The route (`app/api/ai/docs/route.ts`) now requires `workspaceId` in the request body (the docs sidebar is always rendered inside a specific workspace route, so it always knows this) and re-verifies the caller is an ACTIVE member of that workspace via the RLS-respecting session client — `supabase.from("workspace_members").select("status").eq("workspace_id",...).eq("user_id",...).eq("status","active").maybeSingle()` — before trusting it for anything. Deliberately NOT `lib/auth/require-membership.ts`'s `requireActiveMembership` (which takes an admin/service-role client): `app/api/ai/**` is one of the two entry-point roots `lib/ai/__tests__/no-service-role.test.ts` (AS-001) transitively scans for `createAdminClient`/`service_role`/`SUPABASE_SECRET_KEY` references, so no service-role client may ever be reachable from this route. The `workspace_members_select_fellow_members` RLS policy already lets a caller read their own membership row, which is all this check needs.
- `get_current_doc`'s workspace mismatch collapses into the exact same `{status:"empty", reason:"not_found", message:"No matching document found."}` as every other invisible-doc case — never a new reason or differently-worded message — to avoid reintroducing the existence-leak AS-021 currently passes cleanly.
- Deleted/rewrote the misleading "workspace scoping is enforced by RLS ... no extra `.eq(...)` filter is added here on purpose" comments in all three tool files per the spec's explicit instruction, replacing them with the actual current-vs-membership distinction and the F027 rationale.
- Extended (rather than only reading) the existing unit test mocks in `lib/ai/tools/__tests__/*.test.ts` to pass a `WORKSPACE_ID` second argument to every `run()` call, since the signature changed; the "ok" happy-path mocks in `get-current-doc.test.ts` now include a matching `workspace_id` field so the new in-code comparison passes for the right reason (not by `undefined === undefined` coincidence — though that coincidence is also harmless for the malformed-input/error-path tests that never reach the comparison).
- `f007-docs-agent-route.test.ts`: added a `workspace_members` mock chain (`.from().select().eq().eq().eq().maybeSingle()`) defaulting to an active membership, and injected a default `workspaceId` into every `makeRequest()` body via `{ workspaceId: DEFAULT_WORKSPACE_ID, ...body }`, plus one new test proving a failed membership check returns 403 before any model call.

## Out-of-scope work needed
None identified beyond this feature's stated scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: The route's `workspaceId` resolution mechanism was not fully specified anywhere reachable (F027.md says "the route already resolves the caller's workspace," which was aspirational — the route actually hardcoded `workspaceId: ""`). Chose the same convention `app/api/extension/context/route.ts` (F292/F293) already establishes for this exact problem: the caller supplies `workspaceId` explicitly in the request (there, a query param; here, a request-body field, matching this route's existing all-POST-body shape), and the server re-verifies real active membership before trusting it. This is consistent with the docs sidebar always being rendered inside a specific workspace route, so the client always has a real value to send.
AUTONOMOUS_DECISION: Used the RLS-respecting session client (not `lib/auth/require-membership.ts`'s admin-client-based `requireActiveMembership`) for the route's membership re-check, because `app/api/ai/**` is scanned by the AS-001 service-role guard test and an admin-client import there would be a same-file violation of the property this mission's B1 blocker (F023) just fixed.

## Notes for the next worker
- No MCP tools were used for this feature — it is pure application-code + RLS defense-in-depth, no schema/policy change (the fix is entirely at the query layer, matching `lib/queries/docs.ts:163`'s existing convention). No live schema/policy introspection was needed since `docs_select_active_members` and `task_templates_select_non_guest_members`'s definitions were read directly from the migration files.
- If a future feature adds a `create_doc`/`propose_doc_edit` write tool, thread `workspaceId` into it the same way (closure via `forRunner`/`buildDocsAgentTools`, never via the tool's own Zod `inputSchema`).
- The pre-existing `folderHint: null` payload bug in the ORIGINAL F024 `list-doc-templates-isolation.test.ts` test (the "stranger, not a member" scenario) was left untouched — it happens to still prove the right thing there because RLS blocks the row before payload parsing ever runs, so it isn't a false-pass in that specific test, but it's worth someone fixing for consistency/clarity in a future pass.
