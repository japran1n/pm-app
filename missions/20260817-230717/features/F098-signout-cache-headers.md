# F098: signout cache headers

**Milestone:** M2 — Auth & Workspace (follow-up)
**Estimated worker time:** 20 minutes
**Depends on:** F022
**Parent:** F022

## Assertion IDs covered
- AS-022

## Draft scope
- scrutiny-validator found no Cache-Control: no-store / force-dynamic set anywhere on the workspace layout or next.config.ts (confirmed via repo-wide grep) — browser bfcache can restore a previously-authenticated page on back-navigation after sign-out with zero network request, meaning proxy.ts's guard never runs in that path. The existing test (tests/unit/sign-out-back-navigation.test.ts) doesn't actually test this; it re-tests the proxy redirect under a fabricated cookie-less request.
- Add `export const dynamic = "force-dynamic"` (or equivalent no-store Cache-Control) to the workspace layout (app/(workspace)/w/[workspaceSlug]/layout.tsx) so a fresh server round-trip through the auth guard is forced on every visit, defeating bfcache restoration of authenticated content.
- Rewrite the existing test to assert on actual response cache-control headers rather than re-testing proxy redirect logic under a fabricated request. If a genuine bfcache/browser-level test isn't feasible at the unit-test level, document that limitation explicitly and rely on the cache-control header assertion as the primary evidence.

## Files (approximate)
app/(workspace)/w/[workspaceSlug]/layout.tsx, tests/unit/sign-out-back-navigation.test.ts

## Notes for clarification
Source: M2-scrutiny.md, "follow-up-signout-cache-headers". Severity: major.
