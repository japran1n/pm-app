# Handoff: F096 — proxy guard integration test

## Status
COMPLETE

## Assertions covered
AS-001: PASS — new `tests/integration/proxy-auth-guard.test.ts` constructs real `NextRequest` objects, invokes the actual exported `proxy()` from `proxy.ts`, and asserts real redirect Responses (status 307, `Location: https://example.com/sign-in`) for `/w/acme`, `/w/acme/projects/123/board`, `/w/`, and the uppercase edge case `/w/ACME`; asserts NO redirect for `/` and `/sign-in` through the same real `proxy()` call; and separately asserts the exported `config.matcher` pattern matches all four `/w/*` candidate paths and excludes `_next/static`, `_next/image`, `favicon.ico`. All 8 new tests pass. The pre-existing isolated-helper test (`tests/unit/proxy-auth-guard.test.ts`) was left in place (still valid, just narrower) rather than deleted, per the feature spec's "extend or add" framing.

## Files changed
tests/integration/proxy-auth-guard.test.ts (new)

## Commands run
`npx vitest run tests/integration/proxy-auth-guard.test.ts tests/unit/proxy-auth-guard.test.ts` (0, 14/14 passed)
`npx vitest run` (1 — pre-existing unrelated failure, see Notes)
`npx tsc --noEmit` (0)
`npx eslint .` (0)

## Decisions made
- Mocked `@supabase/ssr`'s `createServerClient` at the network boundary only (`getUser` returns `{ data: { user: null } }`), same pattern already used by `tests/unit/sign-out-back-navigation.test.ts` for AS-022. This lets `updateSession()` inside `proxy.ts` run for real (not stubbed) while avoiding a live Supabase call, so the actual `proxy()` code path — including the `requiresAuth` check and `NextResponse.redirect` construction — executes for real.
- Chose `/w/`, `/w/ACME` as edge cases per the spec's "nested and case-variant paths" instruction, in addition to the spec's explicit `/w/acme` and `/w/acme/projects/123/board` examples.
- Matcher test replicates Next.js's own matcher regex source string directly (anchoring `^` and `$`) rather than importing a private Next.js matcher-compilation function, since none is publicly exported from `next/dist` for test use. This directly exercises the string in `config.matcher`, so a change to that string is what the test would catch.

## Out-of-scope work needed
None beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Left the existing `tests/unit/proxy-auth-guard.test.ts` (isolated `requiresAuth` helper test) untouched instead of deleting it — it's still a valid, fast unit test; the gap was that it was the *only* test, not that it was wrong. Added the integration test as a separate file per the spec's "extend or add tests/integration/..." wording.

## Notes for the next worker
- **Next.js 16 `proxy.ts` convention independently confirmed**: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` (bundled with the installed `next@16.3.1` package, not just tech-decisions.md's web-search note) explicitly documents: "The `middleware` file convention is deprecated and has been renamed to `proxy`" and shows the exact `proxy.ts` / `export function proxy(request: NextRequest)` / `export const config = { matcher: ... }` shape this repo's `proxy.ts` uses. This is a second, independent, code-adjacent source beyond the orchestrator's `tech-decisions.md` web-search annotation — both agree. `grep -rn "proxy" node_modules/next/dist -l` also surfaces this docs file and the `next-flight-server-reference-proxy-loader` build tooling, consistent with `proxy` being a first-class, wired-in Next.js 16 file convention rather than a code-comment assumption.
- **Full suite note**: a full `npx vitest run` has one pre-existing, unrelated failure: `tests/integration/workspace-members-list.test.ts` fails with `Failed to create test workspace: JWT issued at future` — a live-Supabase clock-skew/JWT-timing issue against the linked Supabase project, unrelated to `proxy.ts`/AS-001 and not touched by this feature. Running only the proxy-guard test files (as scoped to this feature) passes cleanly (14/14). This matches the milestone scrutiny report's own note about flaky live-DB test infrastructure (see `remove-member.test.ts`'s `afterAll` timeout) — worth a dedicated follow-up but out of scope for F096.
