# Handoff: F006 — Proxy skips the auth call when no session cookie is present

## Status
COMPLETE

## Assertions covered
AS-005: PASS — no `sb-*` auth cookie on a protected path (`/w/*`) redirects to `/sign-in` without calling `getUser()`; verified in `tests/unit/f006-proxy-skips-auth-call.test.ts`.
AS-006: PASS — no `sb-*` auth cookie on a public path passes through without calling `getUser()`; verified in the same file. Also confirmed the guard's condition is strictly cookie-presence, not cookie validity: a chunked cookie (`...auth-token.0`) and a present-but-arbitrary cookie both still go through `updateSession`/`getUser()` unchanged.

## Files changed
lib/supabase/proxy-helpers.ts
proxy.ts
tests/unit/f006-proxy-skips-auth-call.test.ts

## Commands run
`npx vitest run tests/unit/f006-proxy-skips-auth-call.test.ts tests/unit/proxy-auth-guard.test.ts tests/integration/proxy-auth-guard.test.ts` (0, 18/18 passed)
`bash missions/20260913-perf-latency/tools/test-gate.sh` (0, "GATE PASSED — no new unit test failures. Known-failing baseline unchanged.")
`npm run lint` (0 errors, 37 warnings — matches documented baseline)

## Decisions made
- **Cookie family detection**: added `hasAuthCookie(request)` in `lib/supabase/proxy-helpers.ts`. It derives the base cookie name `sb-<project-ref>-auth-token` by taking the subdomain of `NEXT_PUBLIC_SUPABASE_URL` (splitting on `.` after stripping the scheme) — never hard-coded. It then checks every cookie on the request for an exact match on that base name, or a match on `${baseName}.<digits>` (the chunked-cookie suffix `@supabase/ssr` appends when a session is too large for one cookie, e.g. `.0`, `.1`). This covers the chunked case because chunk 0 alone is enough to prove a session cookie exists — the guard only needs "cookie present at all," not the full reassembled value.
- **Guard placement**: `proxy()` now checks `hasAuthCookie(request)` before calling `updateSession`. If absent, it reproduces exactly what the existing code already did for `user === null`: redirect to `/sign-in` when `requiresAuth(pathname)` is true, otherwise `NextResponse.next({ request })` (equivalent pass-through, same shape `updateSession` returns when no cookies are being rewritten). This reuses the existing exported `requiresAuth` rather than reimplementing its logic, per the spec's constraint.
- **No change to the refresh path**: when `hasAuthCookie` is true (cookie present, valid or not), the code falls through unchanged to `updateSession(request)` followed by the original `requiresAuth`/redirect check — byte-identical to the pre-existing code path. A stale, tampered, or foreign-project cookie is still verified against the server, never trusted locally.
- **Test env note**: `NEXT_PUBLIC_SUPABASE_URL` is not guaranteed to be populated inside vitest's process env (confirmed empty in this test file's execution context even though `.env` exists on disk and other test files gate on its presence). The new test file therefore derives its expected cookie base name from `process.env.NEXT_PUBLIC_SUPABASE_URL` at test time using the same derivation as the implementation, rather than hard-coding the project ref — so the test is correct whether or not the env var happens to be populated in a given test run.

## Out-of-scope work needed
None identified. This feature only touched the two files listed in the spec's `Files:` line.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `NextResponse.next({ request })` as the no-cookie/public-path return value (matching what `updateSession` would have produced with no cookies to set) rather than a bare `NextResponse.next()`, to keep request-forwarding behaviour (e.g. any request header rewriting Next.js applies via the `request` option) identical to today's code path for pass-through responses.

## Notes for the next worker
- `tests/unit/proxy-auth-guard.test.ts` (pure `requiresAuth` string matching) and `tests/integration/proxy-auth-guard.test.ts` (full `proxy()` invocation with a mocked `@supabase/ssr`) both still pass unchanged — the integration test's requests carry no cookies at all, so they now exercise the new short-circuit path instead of the old `updateSession` path, and still assert the same redirect/pass-through outcomes, confirming behavioural equivalence.
- No MCP tools were needed for this feature — it is pure request-handling logic with no live schema or remote config to inspect.
