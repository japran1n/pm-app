# Handoff: F001 — Request-scoped current-user helper

## Status
COMPLETE

## Assertions covered
AS-003: PASS — `lib/auth/current-user.ts` exports a single `cache()`-wrapped `getCurrentUser` (and `getRequestClient`) that calls `auth.getUser()`; `lib/actions/authz.ts` now imports it instead of declaring its own. Verified with structural tests in `tests/unit/pf-current-user-cache.test.ts` (4/4 passing) and by full gate run (`GATE PASSED`).

## Files changed
lib/auth/current-user.ts (new)
lib/actions/authz.ts (removed private `getAuthenticatedUser`, now imports `getCurrentUser` from lib/auth/current-user.ts and re-binds it to the old local name)
tests/unit/pf-current-user-cache.test.ts (new)

## Commands run
`npx vitest run tests/unit/pf-current-user-cache.test.ts` (0, 4/4 passed)
`bash missions/20260913-perf-latency/tools/test-gate.sh` (0, "GATE PASSED — no new unit test failures. Known-failing baseline unchanged.")
`npm run lint` (0 errors, 37 warnings — matches accepted baseline)

## Decisions made
- Chose to move the resolver to `lib/auth/current-user.ts` (new file) rather than extend `authz.ts` in place, per the spec's own suggested file path and because it lets non-action call sites (layouts, query helpers in future features F003+) import it without pulling in `authz.ts`'s Server-Action-specific machinery (`withAuthz`, Zod schemas, admin client, etc).
- `lib/actions/authz.ts` keeps its local name `getAuthenticatedUser` bound to the imported `getCurrentUser` (`const getAuthenticatedUser = getCurrentUser;`) rather than renaming every call site inside that file, to keep this diff to exactly the two lines that matter and leave the rest of that file (and its long reasoning comment, which still applies verbatim to the moved function) untouched.
- Also exported `getRequestClient` (cache()-wrapped `createClient()`) as the spec required, even though nothing calls it yet — F003+ will.
- Did not touch `createClient()` in `lib/supabase/server.ts`, the workspace layout, or any query helper — out of scope for this feature per its own "Notes for the worker."
- Test strategy: per the spec's explicit trap warning, did NOT write a test asserting `getUser` is called once across two calls (that fails honestly under plain Vitest, which has no active per-request `cache()` dispatcher, and would only be made to pass by mocking `cache()` itself). Instead wrote four structural tests reading source: (1) exactly one `cache()`-wrapped function in the repo that also calls `auth.getUser`/`auth.getSession` exists, and it lives at `lib/auth/current-user.ts`; (2) that resolver calls `auth.getUser()` and not `auth.getSession()`; (3) `auth.getSession()` never appears in `lib/auth`, `lib/actions`, or `lib/supabase` (scoped away from client-side realtime hooks under `components/`, which legitimately call `getSession()` client-side for a websocket token — a pre-existing, out-of-scope pattern, not a server-side identity check); (4) `lib/actions/authz.ts` imports `getCurrentUser` from the new module and no longer declares its own `cache(async function getAuthenticatedUser...)`.
- What this test suite proves: there is exactly one server-side cache()-wrapped identity resolver, it verifies with `getUser()` never `getSession()`, and no call site duplicates it. What it does NOT prove: that two calls within one real Next.js request actually collapse to one network round trip — that guarantee comes from React's `cache()` + Next's per-request dispatcher (documented at length in both `lib/auth/current-user.ts` and the pre-existing comment in `lib/actions/authz.ts`) and is not observable from a unit test that must not start a dev server.

## Out-of-scope work needed
- F003 onward: switch the workspace layout and query helpers over to call `getCurrentUser()` / `getRequestClient()` instead of building their own `createClient()` + `auth.getUser()`. Not done here per this feature's explicit "creates the helper, doesn't wire it up" scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept `authz.ts`'s internal variable name `getAuthenticatedUser` (rebound to the imported `getCurrentUser`) rather than renaming all its internal call sites to `getCurrentUser`, to minimize diff size and risk in a file with a long, carefully-reasoned existing comment that this feature must not have to re-validate line by line.

## Notes for the next worker
F003 should import from `@/lib/auth/current-user`:
- `getCurrentUser` — returns `Promise<{ supabase: SupabaseClient, user: User | null }>`, memoised per request via React `cache()`. Use this anywhere a Server Component/layout/query helper currently does its own `createClient()` + `supabase.auth.getUser()`.
- `getRequestClient` — returns `Promise<SupabaseClient>` (the same client instance `getCurrentUser` uses internally), also `cache()`-wrapped, for call sites that need only the client and not the user (e.g. to avoid a second `getUser()` round trip when the caller already has the user from elsewhere in the same request).

Both are async functions (must be awaited) and both are safe to call from multiple places in the same request — under the real Next.js runtime they collapse to one `auth.getUser()` network call per request; under plain Vitest they don't memoize (see the header comment in the file), so don't write a test asserting call-count deduplication in Vitest — assert structurally instead (see this feature's test file, `tests/unit/pf-current-user-cache.test.ts`, for the pattern).

`lib/actions/authz.ts`'s `getAuthenticatedUser` local binding still exists (now just an alias for `getCurrentUser`) so nothing inside that file needed to change beyond the import — F003 does not need to touch `authz.ts` at all.

No MCP tools were used for this feature (pure code refactor, no live schema/policy interaction).
