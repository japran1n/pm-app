# Handoff: F077 — dashboard rls verification

## Status
COMPLETE

## Assertions covered
AS-133: PASS — new adversarial integration test `tests/integration/dashboard-rls-cross-workspace.test.ts` (run against the real linked Supabase project, `npx vitest run tests/integration/dashboard-rls-cross-workspace.test.ts`): a member of workspace A calls `get_priority_counts`, `get_status_counts`, and `get_overdue_count` passing workspace B's id (a workspace they are NOT a member of) directly as `p_workspace_id`. Workspace B is seeded with real, non-trivial data (an 'urgent' task, a 'low' task, and a genuinely overdue task) so a zero/empty result is proof of RLS enforcement, not an artifact of workspace B having nothing to leak. All three calls return `error: null` with empty/zero results — 4/4 tests pass.

## Files changed
tests/integration/dashboard-rls-cross-workspace.test.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint tests/integration/dashboard-rls-cross-workspace.test.ts` (0)
`npm run test` (0)
`npx vitest run tests/integration/dashboard-rls-cross-workspace.test.ts tests/integration/priority-counts-rpc.test.ts tests/integration/status-counts-rpc.test.ts tests/integration/overdue-count-rpc.test.ts` (0 — 4 files, 14 tests passed, run against the real linked Supabase project via `.env`)
`npm run lint` (0 — 1 pre-existing unrelated warning in lib/queries/search.ts, 0 errors)
`npm run build` (0 — Next.js production build succeeded)

## Decisions made
- Investigated first before writing anything: F071 (`get_priority_counts`), F072 (`get_status_counts`), and F075 (`get_overdue_count`) each already ship an individual "RLS-enforced" negative test (`tests/integration/priority-counts-rpc.test.ts`, `status-counts-rpc.test.ts`, `overdue-count-rpc.test.ts`) proving a non-member gets zero/empty results for a workspace they don't belong to. Rather than duplicate that coverage, F077 adds one dedicated, consolidated adversarial test file that: (a) explicitly names AS-133 in every test title (the existing per-RPC tests reference their own feature's assertion IDs, not AS-133), and (b) seeds the non-member workspace with real, distinguishable data (specific priority values, an overdue task) rather than an empty workspace, so the assertion demonstrably rules out "there was nothing to leak" as an explanation for the zero/empty result.
- All three RPCs are `language sql stable security invoker` (confirmed by reading the migrations directly: `supabase/migrations/20260818054815_rpc_priority_counts.sql`, `20260818070000_rpc_status_counts.sql`, `20260818080000_rpc_overdue_count.sql`), so RLS policies `tasks_select_active_members` / `projects_select_active_members` apply under the caller's own role regardless of the `p_workspace_id` argument passed — this is the mechanism the test proves holds under adversarial input, not just conventional UI usage.
- Included one additional "sanity check" test (member reading their own, legitimately-empty, workspace A) to prove the RPCs still function correctly for the caller and the zero result for workspace B isn't caused by e.g. a broken auth session.

## Out-of-scope work needed
None identified. The three dashboard RPCs in scope for M7 (priority, status, overdue counts) are now each covered by both a per-feature RLS test and this consolidated AS-133 test. If a future dashboard RPC is added (e.g. a trend/velocity aggregate), it should get the same "RLS-enforced" test added to its own integration test file plus a new case appended to this file's cross-workspace suite.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Wrote a new, dedicated test file rather than only extending the existing per-RPC test files, because the spec (F077) is itself a distinct, named verification feature with its own assertion (AS-133) and its own evidence-artifact requirement — a standalone file that can be run and pointed to on its own gives a cleaner audit trail than folding it into F071/F072/F075's files, which are scoped to their own assertion IDs.

## Notes for the next worker
- Test file: `tests/integration/dashboard-rls-cross-workspace.test.ts`. Follows the same `loadDotEnv`/`describe.skipIf(!haveAdminCreds)` pattern as every other file in `tests/integration/`; requires `.env` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` to actually run (present in this repo's `.env`, so it ran for real against Supabase, not skipped).
- Did not use Supabase MCP for this feature — no schema/RLS/policy changes were needed (F071/F072/F075's migrations already implement `security invoker` correctly); this was a test-only verification feature, so plain SQL migration reads via `Read`/`Bash cat` were sufficient to confirm the mechanism before writing the test.
- `npm run test` (the tech-decisions.md test command) only runs `tests/unit/`, not `tests/integration/` — integration tests require live Supabase credentials and are run separately via `npx vitest run tests/integration/...`. Both were run and both pass.
