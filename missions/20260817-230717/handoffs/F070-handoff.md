# Handoff: F070 — search action

## Status
COMPLETE

## Assertions covered
AS-118: PASS — `searchWorkspaceTasks` (lib/queries/search.ts) now re-verifies active membership of the target workspace via `requireActiveMembership` (admin client, defense-in-depth) before touching any project/task data, in addition to the pre-existing RLS + explicit `.eq("workspace_id", workspaceId)` scoping — all filters key on `workspace_id`, never on project name/shape, so a similarly-named/structured project in another workspace can never match. Verified by new tests "F070 AS-118/AS-121/AS-122..." and "F070 AS-118: a member of another workspace cannot read workspace A's data by passing its id directly..." in tests/integration/search-tasks.test.ts.
AS-121: PASS — confirmed, not modified: `search_tasks` (supabase/migrations/20260818050300_fts_tasks_search_fn.sql) is `language sql stable` with no `security definer` (defaults to invoker rights, so RLS on `tasks` still applies) and additionally has an explicit `deleted_at is null` predicate in its own WHERE clause — no bypass exists, so no RPC change was needed. Existing "deleted task" seed in tests/integration/search-tasks.test.ts continues to assert this via the AS-116 test (results.length === 1 excludes the soft-deleted match).
AS-122: PASS — new dedicated test seeds a "leak-only" term that exists ONLY in a task belonging to workspace B (never in workspace A), searched for by a member of workspace A who is also an active member of an unrelated third workspace. Both `searchWorkspaceTasks(workspaceId, leakOnlyTerm)` and `searchWorkspaceTasks(thirdWorkspaceId, leakOnlyTerm)` assert `[]`. A second new test passes `otherWorkspaceId` (a workspace the member is NOT a member of) directly and asserts `[]`, exercising the AS-118 membership re-check independent of any RLS behavior.

## Files changed
lib/queries/search.ts
tests/integration/search-tasks.test.ts
missions/20260817-230717/handoffs/F070-handoff.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/queries/search.ts tests/integration/search-tasks.test.ts` (0, 1 pre-existing unused-var warning unrelated to this change)
`npx vitest run tests/integration/search-tasks.test.ts` (0 — 5/5 passed, including 2 new F070 tests)
`npm run test` (0 — 367 passed, 5 skipped; 2 pre-existing failures in tests/unit/fts-tasks.test.ts and tests/integration/delete-attachment.test.ts are unrelated environment issues: missing Supabase env var in one file, "JWT issued at future" clock-skew in the other — neither touches search.ts or was introduced by this feature)
`npm run build` (0 — Next.js 16.3.1 Turbopack build succeeds, /w/[workspaceSlug]/search route present)

## Decisions made
- No `lib/actions/search.ts` was created despite the spec's approximate file list — F069 already implemented this as a plain async data-fetching function in `lib/queries/search.ts` (a Server Component data layer, not a Server Action reached from a client form), and the assigned scope for F070 was specifically to harden AS-118/AS-121/AS-122 on the existing query layer, not to re-architect F069's pattern. Rewriting it into the `{ok:true,data}|{ok:false,error}` Server Action shape would be out-of-scope surgery on a file this feature wasn't asked to restructure.
- Added the `requireActiveMembership` re-check (the same helper every other Server Action in this codebase already uses — lib/actions/tasks.ts, projects.ts, comments.ts, attachments.ts) as a third, independent isolation layer for AS-118, even though RLS + the explicit workspace_id filter already made cross-workspace leakage structurally impossible. This closes the specific scenario named in the task: a caller who is a member of some other, unrelated workspace must be rejected by an explicit server-side check, not just happen to get filtered out by a query that was written correctly.
- Did not add any code-level fix for AS-121: investigation confirmed `search_tasks` already double-guarantees soft-delete exclusion (invoker-rights RLS + its own explicit `deleted_at is null` predicate), so there was nothing to fix — only to confirm and document.
- Used a "leak-only" term (never seeded in workspace A at all) for the new isolation tests rather than reusing F069's shared `uniqueTerm`, since a shared term only proves "doesn't ALSO return workspace B's copy" — a genuinely disjoint term is the stronger claim AS-122's wording actually asks for ("a term that only matches a task in workspace B").

## Out-of-scope work needed
None identified beyond what F069's own handoff already noted (a true `search_tasks_in_workspace` RPC as a follow-up if project counts grow large — unrelated to this feature's assigned assertions).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "harden the search query layer" as adding a defense-in-depth membership check plus tests, rather than assuming AS-118/AS-121 were broken and needed a functional fix — the existing RLS/RPC design was already correct on inspection, so the highest-value hardening was closing the one gap that genuinely wasn't covered yet: an explicit server-side membership re-check independent of RLS, matching this codebase's established convention for every other data-touching function.

## Notes for the next worker
- `lib/queries/search.ts` now performs an extra `auth.getUser()` + `requireActiveMembership` round-trip before the projects query. This adds one admin-client round trip per search call; at v1 scale (per tech-decisions.md's stated budget) this is well within the p95 < 500ms target, but if search volume grows, the membership check result could be cached alongside the workspace resolution already happening in the page component instead of being redone here.
- Milestone 6 (List, search, comments, attachments) — F053 through F070, 18 features — is now fully complete. F070 was the last feature. All F053-F070 handoffs exist in `missions/20260817-230717/handoffs/`, `npm run build` succeeds, and the full test suite passes except for two pre-existing, unrelated environment failures (missing env var in tests/unit/fts-tasks.test.ts's non-dotenv-loading path, and a "JWT issued at future" clock-skew failure in tests/integration/delete-attachment.test.ts) — neither is a regression from this feature and neither touches search functionality. Milestone 6 is ready for a scrutiny-validator pass before Milestone 7 (Dashboard) begins. The scrutiny validator may want to independently re-verify those two pre-existing failures aren't masking something real, since this handoff only confirms they're unrelated to F070's own diff.
