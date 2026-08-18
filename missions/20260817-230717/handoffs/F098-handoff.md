# Handoff: F098 — signout cache headers

## Status
COMPLETE

## Assertions covered
AS-022: PASS — added `export const dynamic = "force-dynamic"` to `app/(workspace)/w/[workspaceSlug]/layout.tsx`; confirmed via `npm run build` that `/w/[workspaceSlug]` is now marked dynamic (ƒ) rather than statically/cache-eligible, and via the rewritten unit test that the module actually exports `dynamic === "force-dynamic"`.

## Files changed
app/(workspace)/w/[workspaceSlug]/layout.tsx
tests/unit/sign-out-back-navigation.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run test` (0) — 19 files, 98 tests passed
`npm run build` (0)

## Decisions made
- Used `export const dynamic = "force-dynamic"` (Next.js route-segment config) rather than manually setting a `Cache-Control` header, per the spec's primary suggestion — it's the idiomatic Next 16 mechanism for opting a Server Component route out of static rendering/caching and forces a real server round-trip (and therefore the auth guard chain) on every visit, including browser back-navigation.
- Rewrote `tests/unit/sign-out-back-navigation.test.ts` to import the layout module directly and assert `layoutModule.dynamic === "force-dynamic"`, instead of re-testing `proxy()`'s redirect behavior under a fabricated cookie-less request (that mechanism is already covered by F096's proxy tests and never actually exercised the bfcache gap — a fabricated request always hits the server, which was never in question).
- Documented explicitly in the test file's header comment that genuine bfcache restoration (sign in, load a workspace page, sign out, press back, assert no stale DOM with zero network request) requires a real browser and belongs at the E2E/Playwright level (AS-150), not unit level. The unit test's job is narrower: verify the specific mechanism (`dynamic = "force-dynamic"`) that defeats bfcache restoration is actually present on the module.

## Out-of-scope work needed
None identified specific to this feature. A genuine browser-level bfcache regression test (Playwright: sign in -> visit /w/<slug> -> sign out -> press back -> assert redirected/no stale content) would be a good addition at the E2E layer but is out of scope for this unit-test-focused follow-up per the spec's own fallback guidance ("If a genuine bfcache/browser-level test isn't feasible at the unit-test level, document that limitation explicitly").

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `force-dynamic` over manually setting `Cache-Control: no-store` response headers because it's the standard, spec-recommended-first option and Next.js's `force-dynamic` route config already governs the Cache-Control behavior for dynamic routes; adding a duplicate manual header would be redundant and risk drifting out of sync with framework behavior.

## Notes for the next worker
- `npm run build` output is the fastest way to re-verify this fix didn't regress: check the Route table shows `ƒ` (dynamic) next to `/w/[workspaceSlug]`, not `○` (static).
- The old test's own doc comment (pre-fix) incorrectly asserted "Next.js Server Component routes are not cached client-side the way an SPA route would be" — that claim is what scrutiny flagged as wrong; browser bfcache operates below the React/Next rendering model and can restore server-rendered RSC output too, absent a cache-control signal telling it not to.
