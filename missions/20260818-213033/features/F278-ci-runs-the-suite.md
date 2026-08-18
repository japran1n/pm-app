# F278: make CI actually execute the test suite

**Milestone:** M10 (follow-up from M10 scrutiny)
**Estimated worker time:** 45 minutes
**Depends on:** none
**Parent feature:** cross-cutting (M10 scrutiny)

## Assertion IDs covered
- none directly; this is the evidence layer every assertion's test depends on (and a precondition for AS-530 in M18)

## Why this exists
M10 scrutiny, cross-cutting blocker: `.github/workflows/ci.yml` has no `env:` block and references no secrets. Every integration test in this milestone is silently skipped by `describe.skipIf(...)` while CI reports green, `package.json`'s test script short-circuits to `echo ... exit 0` under a condition that no longer applies, and the Playwright step cannot boot because `proxy.ts` throws without Supabase env. Nine of M10's fourteen assertions are protected only by someone remembering to run the suite locally. This is pre-existing, not introduced by M10 — but it is why several failures shipped marked COMPLETE.

Scope note: the user cut platform/infra hardening from this mission. This feature is deliberately narrow — make CI run the tests that already exist. It does not expand test coverage, add monitoring, or touch deployment.

## Draft scope
- Add the Supabase URL, publishable key and secret key to the workflow's `env:` from repository secrets.
- Replace `describe.skipIf(...)` with a hard failure when credentials are absent in CI, keeping the local skip.
- Drop `package.json`'s `echo ... exit 0` placeholder.
- Raise vitest's `testTimeout` to ~30s in `vitest.config.ts`: at the default 5s the suite is non-deterministically red against the remote project (two consecutive runs gave 41 and 36 failures; at 30s it is 575/575 green).

## Files (approximate)
.github/workflows/ci.yml, vitest.config.ts, package.json, tests/integration/* (skip guards)

## Clarified implementation
- Archetype: audit. Do not add new test coverage here; only make the existing suite execute and report honestly.
- The orchestrator cannot add GitHub repository secrets — if they are absent, wire the workflow to read them and state in the handoff exactly which secret names a human must add.

## Definition of done
- A CI run with credentials present executes the integration and e2e suites rather than skipping them.
- A CI run with credentials absent fails loudly instead of reporting green.
- `npm run test` is deterministic locally across two consecutive runs.
