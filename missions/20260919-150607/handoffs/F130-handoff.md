# Handoff: F130 — Fix AS-006: 9 pre-existing unit test failures

## Status
COMPLETE

## Assertions covered
AS-006: PASS — `npx vitest run tests/unit` now exits 0 with 505 test files / 3339 tests passing (3 skipped), 0 failing. `npx tsc --noEmit` exits 0.

## Files changed
tests/unit/watching-feed-query.test.ts
tests/unit/f042-no-approval-lock-comments.test.ts
tests/unit/f019-my-tasks-realtime-hook-set-identity.test.tsx
tests/unit/f022-board-realtime-guard-call-site.test.tsx
tests/unit/f027-calendar-realtime-wiring.test.tsx
tests/unit/f039-portal-guards.test.ts
tests/unit/f251-list-table-realtime.test.tsx
tests/unit/personal-todo-list-realtime-wiring.test.tsx
tests/unit/undo-toast.test.tsx

## Commands run
`npx vitest run tests/unit --reporter=verbose` (1, before fixes — 9 failed files / 30 failed tests)
`npx vitest run tests/unit/watching-feed-query.test.ts` (0, after fix)
`npx vitest run tests/unit/f042-no-approval-lock-comments.test.ts` (0, after fix)
`npx vitest run tests/unit/f019-my-tasks-realtime-hook-set-identity.test.tsx` (0, after fix)
`npx vitest run tests/unit/f022-board-realtime-guard-call-site.test.tsx` (0, after fix)
`npx vitest run tests/unit/f027-calendar-realtime-wiring.test.tsx` (0, after fix)
`npx vitest run tests/unit/f039-portal-guards.test.ts` (0, after fix)
`npx vitest run tests/unit/f251-list-table-realtime.test.tsx` (0, after fix)
`npx vitest run tests/unit/personal-todo-list-realtime-wiring.test.tsx` (0, after fix)
`npx vitest run tests/unit/undo-toast.test.tsx` (0, after fix)
`npx vitest run tests/unit` (0, full suite — 504 passed | 1 skipped test files, 3339 passed | 3 skipped tests)
`npx tsc --noEmit` (0)

## Decisions made
- `watching-feed-query.test.ts`: the Supabase server-client mock's `createClient()` return object was missing `rpc` entirely (production code added an `rpc("get_latest_task_activity", ...)` call after this test was written). Added `rpc: vi.fn(async () => ({ data: [], error: null }))` to the mock client — matches the existing `error: null` shape used by every other mocked query in this file, and the test only asserts on the `tasks` select string / assembled `taskKey`, not on activity data, so an empty rpc result is a safe no-op default.
- `f042-no-approval-lock-comments.test.ts` (AS-172): the previous fix stripped two hardcoded phrases ("doc comment", "// comment for how") before scanning for the word "comment", but a newer JSX comment in `section-card.tsx` ("F025's comment above...") didn't match either literal phrase. Rather than add another one-off phrase (which just chases the next new comment), I replaced the approach with a general "strip every block comment (`/* ... */`, which also covers JSX comment nodes `{/* ... */}`) and every line comment (`// ...`) from the source before scanning" — this is robust to any future doc comment that happens to use the word "comment" about itself, while still failing if an actual comment-thread/comment-input FEATURE is added outside a comment.
- The six `supabase.auth` failures (f019, f022, f027, f039, f251, personal-todo-list, undo-toast) all stem from `lib/realtime/subscribe-when-authenticated.ts` (an F023 hoisted guard) calling `supabase.auth.getSession()` before any channel subscribes — this guard was added after these test files' Supabase mocks were written, so none of them had an `auth` key. Added a consistent `auth: { getSession, getUser, onAuthStateChange }` mock (session with `access_token` omitted, so the guard's `supabase.realtime.setAuth()` branch is skipped and no `realtime` mock is needed) to each affected mock client.
- Because `subscribeWhenAuthenticated` defers the actual `.channel()/.on()/.subscribe()` call until the `getSession()` promise resolves, several tests that previously read `onCalls`/captured callbacks synchronously right after `render()`/`renderHook()` needed an explicit microtask flush (`await act(async () => { await Promise.resolve(); await Promise.resolve(); })`) inserted before that read. Applied this to f019, f027, f251, and personal-todo-list-realtime-wiring; f022 turned out not to need it (that file's render + subsequent `act()`-wrapped drag interactions apparently already gave the promise enough ticks to resolve before the callback was read).
- `f039-portal-guards.test.ts` had two more missing-export failures than the spec described, uncovered only after fixing what the spec listed: the real `layout.tsx` under test now also imports `getClientVisibleStagingLinks` (from `@/lib/queries/project-site`) and `isPortalProjectArchived` (from `@/lib/queries/portal`), neither mocked. Added both as `vi.fn(async () => ...)` stubs returning safe defaults (`{ ok: true, data: [] }` and `false` respectively) so the guard logic under test (notFound on disabled/non-member) is reached without being short-circuited by an unrelated missing mock.
- Did not touch any production code — every fix was confined to test-file mocks/assertions, per the feature's scope constraint and because the underlying production behavior (RPC call, auth-hydration guard, real imports) is intentional and covered by other passing tests.

## Out-of-scope work needed
None identified beyond this feature's scope. `tests/integration/**` were not touched (explicitly out of scope per the spec).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: For f042's JSX-comment false positive, generalized the fix from "strip known phrases" to "strip all comment syntax" instead of adding a third one-off phrase, since the spec's suggested approach (narrow the regex to exclude JSX comment strings) would need updating again for any future doc comment using the word "comment" about itself.
AUTONOMOUS_DECISION: Where `subscribeWhenAuthenticated`'s deferred subscribe caused synchronously-read `onCalls` to be empty, added a two-tick `await act(async () => { await Promise.resolve(); await Promise.resolve(); })` flush rather than switching to `waitFor()`, matching the minimal-diff style already used elsewhere in these test files.

## Notes for the next worker
- No MCP tools were used — this feature is purely a test-suite fix with no live external service state to inspect.
- The two extra missing-mock issues found in f039 (`getClientVisibleStagingLinks`, `isPortalProjectArchived`) were not mentioned in the feature spec; they only surfaced once the spec's `getClientVisiblePortalLinks` mock was already in place. Worth noting for future spec authors: pre-existing failing-test specs should be re-verified against current `main` before being handed to a worker, since production code can drift between when the spec was written and when it's picked up.
- `git status` shows several other untracked mission-state files (features/, handoffs/ for other F-numbers, milestones/, run-log.md, plan.md modification) that predate this session and were left untouched/unstaged, per this feature's scope (only the 9 listed test files).
