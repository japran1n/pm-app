# Handoff: F043 — FU-1 behavioural membership-denial test for the converter route

## Status
COMPLETE

## Assertions covered
AS-003: PASS — `tests/unit/workspace-layout-membership-denial.test.ts` calls `WorkspaceLayout` directly with a signed-in non-member user and the converter page as `children`, and asserts `notFound()` is called (mutation-verified, see Decisions made).
AS-004: PASS — `tests/unit/proxy-auth-guard.test.ts` now asserts `requiresAuth("/w/acme/tools/webflow")` is `true` explicitly (was previously covered only by construction via the general `/w/<slug>/...` nested-route case).

## Files changed
tests/unit/workspace-layout-membership-denial.test.ts (new)
tests/unit/proxy-auth-guard.test.ts

## Commands run
`npx vitest run tests/unit/workspace-layout-membership-denial.test.ts tests/unit/proxy-auth-guard.test.ts` (0)
`npx vitest run --exclude 'tests/integration/**'` (0) — 474 files / 3107 tests passed, 1 file / 3 tests skipped (pre-existing, unrelated to this feature)
Mutation test (see Decisions made below) — manual guard removal/restoration, not a persisted script

## Decisions made
- Followed `tests/unit/f039-portal-guards.test.ts`'s established pattern (call the Server Component function directly with mocked `next/navigation`, `getCurrentUser`, and the relevant query module) rather than a full React Testing Library DOM render — `WorkspaceLayout` imports ~20 child components (AppSidebar, MembershipProvider, all nav figures, CommandPalette, etc.) that would all need individual mocking to render past the guard; since the assertion under test is that the function throws via `notFound()` *before* any of that JSX is reached, calling the function directly and asserting the rejection is sufficient and matches the spec's own template reference (`workspace-not-found-scope.test.ts`, which similarly asserts on the query result the layout branches on rather than a full DOM render).
- Mocked `getCurrentUser`'s returned `supabase` object to support the `workspace_slug_history` lookup the layout runs before giving up with `notFound()` (checks for a retired-slug redirect first) — returning `{ data: null, error: null }` from that chain so the layout falls through to the generic 404, exactly matching AS-144's "nonexistent and non-member slugs are indistinguishable" behaviour that F023's integration test already covers at the RLS layer.
- **Mutation test, performed and verified manually as the acceptance criterion requires:**
  1. Backed up `app/(workspace)/w/[workspaceSlug]/layout.tsx`.
  2. Edited the guard from `if (!activeWorkspace) {` to `if (false && !activeWorkspace) {` (deleting/neutralizing the guard without touching surrounding code).
  3. Ran `npx vitest run tests/unit/workspace-layout-membership-denial.test.ts` — **RED**: `AssertionError: expected [Function] to throw error including 'NEXT_NOT_FOUND' but got 'supabase.from(...).select(...).eq(...).eq is not a function'`. This confirms the test fails when the guard is removed — with the guard gone, the layout body falls through to `Promise.all([...])`, calling `.eq(...).eq(...)` on the minimal mocked supabase client (which only stubs the slug-history lookup shape), so the layout no longer throws `NEXT_NOT_FOUND` at all. The test correctly goes red regardless of the exact downstream failure mode, because it specifically asserts the `NEXT_NOT_FOUND` throw and `notFound()` call count, neither of which occur once the guard is gone.
  4. Restored the original file from the backup (verified `git diff` on the layout file is empty, i.e. the codebase is unmodified).
  5. Re-ran the same test — **GREEN**, along with the rest of the unit suite (see Commands run).
- Named AS-004 explicitly in `proxy-auth-guard.test.ts` per the spec, using the exact route from the spec text (`/w/acme/tools/webflow`).

## Out-of-scope work needed
None identified beyond what F043 already scopes. The `tests/integration/**` suite's pre-existing failure (env var guard bug in `tests/setup/testing-library.ts`) is tracked in `missions/20260917-170249/handoffs/F046-handoff.md` and is unrelated to this feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the F039 direct-function-call pattern instead of a literal React Testing Library `render()` of `WorkspaceLayout`, because a full DOM render would require mocking every child component the layout imports (irrelevant to the assertion under test, which only concerns whether `notFound()` fires before any of that JSX is produced) — this keeps the test focused on the exact behaviour AS-003 describes and matches the codebase's existing convention for this class of guard test.

## Notes for the next worker
- No MCP tools used — this feature is pure test-code, no live external service state involved.
- The mutation test is not committed as a script (per the spec's ask to "verify this yourself... and say so explicitly in the handoff", not to ship a mutation-testing harness); the transcript above documents the manual verification. If a future feature wants persistent mutation coverage, consider a dedicated mutation-testing tool (e.g. Stryker) rather than ad hoc find/replace scripts.
- `git diff` on `app/(workspace)/w/[workspaceSlug]/layout.tsx` was empty after mutation-test cleanup — confirmed via `git status`/`git diff --stat` before committing, so the guard itself was never actually weakened in the committed code.
