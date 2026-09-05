# Handoff: F015 — Fix-up: scrutiny-1 findings (debug logging + surviving mutant)

## Status
COMPLETE

## Assertions covered
AS-024: PASS — `npx vitest run tests/unit/portal-overview-live.test.tsx` (6/6 tests pass), including new `test_AS_024_subscription_is_torn_down_and_reacquired_when_workspace_id_changes`. Mutation-verified: with `usePortalOverviewRealtime`'s effect deps temporarily set to `[]`, this new test FAILS (`expected "vi.fn()" to be called 1 times, but got 0 times`); with deps restored to `[workspaceId]`, it PASSES.
AS-032: PASS — `npm run lint` returns 0 errors, 15 pre-existing warnings (unrelated files). The `console.log("F012_DEBUG event", ...)` line flagged in scrutiny-1 as the mission's sole new lint error / blocker is not present in the codebase; see Notes below for why no code change was needed for finding (1).

## Files changed
tests/unit/portal-overview-live.test.tsx

## Commands run
`npx vitest run tests/unit/portal-overview-live.test.tsx` (0, 6/6 pass)
`npx vitest run tests/unit` (0, 1573/1573 pass)
`npx vitest run` (full suite; 42 pre-existing failures, all in `tests/integration/*` due to Supabase auth "Request rate limit reached" during test-user sign-in — unrelated to this feature, not touched by this change)
`npx tsc --noEmit` (pre-existing errors only, in `components/portal/task-list.tsx` / `task-list.test.tsx`, both explicitly off-limits per this feature's instructions and owned by a different in-flight worker)
`npm run lint` (0, 0 errors / 15 warnings, none in files touched here)

## Decisions made
- Finding (1) (BLOCKER, `console.log("F012_DEBUG event", ...)` at `components/portal/portal-overview-live.tsx:118`): read the file at the start of this session and it was present in the working tree exactly as scrutiny-1 described, along with an `(event as any).new` cast on the same line. Removed the line. After removal, `git diff HEAD -- components/portal/portal-overview-live.tsx` was empty — the committed version at HEAD (`0f97b51`) never contained this line, so it must have been an uncommitted, not-yet-committed artifact left in the working tree from a prior debugging pass (likely by whoever last touched the neighboring F012 realtime-auth fix, given the `F012_DEBUG` tag). No `(event as any)` casts or other stray `console.*` calls were found anywhere else in `portal-overview-live.tsx`, `use-portal-overview-realtime.ts`, or `lib/portal/subscribe-portal-overview-realtime.ts` (checked via `grep -n "console\.\|as any"` across all three files before and after the fix).
- Finding (2) (MAJOR, surviving mutant on the `[workspaceId]` deps array): added `test_AS_024_subscription_is_torn_down_and_reacquired_when_workspace_id_changes` to the existing `tests/unit/portal-overview-live.test.tsx` suite, following that file's established pattern (mock `subscribeToPortalOverviewRealtime`, render, then `rerender` with a new `workspaceId` prop, assert the old `unsubscribe` spy fires exactly once and a second `subscribeToPortalOverviewRealtime` call is made with the new workspace id). Made `subscribeToPortalOverviewRealtime` itself a `vi.mocked()` reference (`subscribeMock`) rather than adding a second parallel mock, to keep one source of truth for call assertions and avoid duplicating the existing `vi.mock` factory.
- Did not modify `components/portal/use-portal-overview-realtime.ts` itself — the existing `[workspaceId]` deps array is already correct; only a test was missing to pin that behaviour.

## Out-of-scope work needed
- **Concurrent edit observed on `components/portal/use-portal-overview-realtime.ts` during this session**: partway through this task, the working-tree copy of that file was rewritten (uncommitted, presumably by another in-flight worker on F012) to wrap channel subscription in an async `supabase.auth.getSession()` / `realtime.setAuth()` sequence before calling `subscribeToPortalOverviewRealtime`, to fix an unauthenticated-Realtime-join race (see that diff's own inline comment, tagged F012/AS-029). This was NOT part of this feature's scope and was left untouched — my commit for this handoff only includes `tests/unit/portal-overview-live.test.tsx` and does not include or depend on that other file's changes. Whoever lands that F012 change should re-run `tests/unit/portal-overview-live.test.tsx` afterward: the new async `getSession().then(...)` indirection means `subscribeToPortalOverviewRealtime` is no longer called synchronously inside the effect, so the mocked-callback-capture tests in this file (including the new AS-024 re-render test added here) may need an `await act(async () => {...})` / flush added around `render`/`rerender` calls to keep passing once that change lands.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Since the console.log removal produced no diff against HEAD (it was uncommitted working-tree drift, not a committed regression), I did not create a separate commit for finding (1) — there was nothing to commit. Both findings are addressed by the single commit for finding (2)'s new test, which is what actually needed landing. This is noted explicitly here so the orchestrator doesn't look for a second commit that doesn't exist.

## Notes for the next worker
- Mutation-verify workflow used for AS-024: `sed -i '' 's/}, \[workspaceId\]);/}, []);/' components/portal/use-portal-overview-realtime.ts`, ran the test file (new test failed as expected, others still passed), then `sed -i '' 's/}, \[\]);/}, [workspaceId]);/'` to restore, re-ran (all 6 pass). No net diff on that file was left behind.
- `git diff HEAD -- components/portal/portal-overview-live.tsx components/portal/use-portal-overview-realtime.ts` was empty both before I started checking finding (1) resolution and after cleanup — confirms neither source file needed a real code change for this fix-up; only the test file did.
- No MCP tools were used — this is a pure client-side React/testing fix with no external service or schema surface.
