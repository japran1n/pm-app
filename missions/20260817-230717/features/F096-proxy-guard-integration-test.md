# F096: proxy guard integration test

**Milestone:** M2 — Auth & Workspace (follow-up)
**Estimated worker time:** 20 minutes
**Depends on:** F010
**Parent:** F010

## Assertion IDs covered
- AS-001

## Draft scope
- scrutiny-validator found the only test for AS-001 calls the isolated `requiresAuth` helper directly, never builds a real NextRequest, never invokes `proxy()`, never asserts an actual redirect, and never verifies `config.matcher` actually routes /w/* through the guard. AS-001 as literally worded is unverified.
- Add an integration-style test that builds a real NextRequest for a representative set of /w/* paths (including nested and case-variant paths) with no auth cookie, invokes the actual exported `proxy()` function, and asserts a redirect Response to /sign-in.
- Add a matcher-regex test asserting /w/anything matches the exported `config.matcher`.
- Independently confirm (read Next.js 16's actual bundled docs/source, not just tech-decisions.md's note) that `proxy.ts` at repo root is a real, wired-in Next.js 16 convention — document the confirmation source in the handoff.

## Files (approximate)
tests/unit/proxy-auth-guard.test.ts (extend or add tests/integration/proxy-auth-guard.test.ts), proxy.ts (read-only unless a real gap is found)

## Notes for clarification
Source: M2-scrutiny.md, "follow-up-proxy-guard-integration-test". Severity: blocker.
