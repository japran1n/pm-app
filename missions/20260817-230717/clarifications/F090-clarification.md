# F090 Clarification

_Generated: 2026-08-17T21:45:00Z_  _Mode: accept-and-continue_
_Answered by: orchestrator, on standing user authorization — ★ defaults taken for all 20 questions, no interactive round._

## Round A - 10 task questions

**1. Implementation pattern**
_How is this test authored?_
- (a) Playwright spec file for e2e, or Vitest for unit — per tech-decisions.md's 'How to run tests' commands, matching the assertion's nature  ★ recommended — chosen
- (b) a manual QA script only, no automated code
- (c) a snapshot test only
- (d) undefined tooling

**2. Data shape**
_What test data/fixtures does this test use?_
- (a) a small seeded fixture created within the test itself (or supabase/seed.sql for e2e), isolated from other tests' data  ★ recommended — chosen
- (b) shared mutable global fixtures
- (c) production data (never — flag if ever suggested)
- (d) no fixtures, relies on whatever happens to exist

**3. State / storage location**
_Where does test state get set up and torn down?_
- (a) created and cleaned up within the test (setup/teardown hooks), never leaking into other tests  ★ recommended — chosen
- (b) left in the database permanently after the test run
- (c) managed manually between runs
- (d) undefined

**4. Target assertion**
_Which assertion(s) must this test provably fail against if the behavior breaks?_
- (a) exactly the assertion ID(s) listed in this feature's 'Assertion IDs covered' section — test name references the ID per worker.md convention  ★ recommended — chosen
- (b) a broader set not explicitly assigned
- (c) an unrelated assertion
- (d) undefined — worker picks arbitrarily

**5. Failure / error handling**
_If the test itself is flaky (intermittent failure unrelated to the assertion), what happens?_
- (a) worker investigates and fixes the flake as part of this feature — a flaky test is not acceptable evidence for a milestone boundary
- (b) worker deletes the test and marks the assertion PASS anyway
- (c) worker marks Status PARTIAL and documents the flake precisely in Blockers with SUGGESTED FOLLOWUP  ★ recommended — chosen
- (d) worker ignores it, re-runs until it happens to pass

**6. Empty / zero state**
_N/A — test-authoring feature._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**7. Validation rules**
_N/A — the test itself IS the validation for its target assertion(s)._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**8. Performance budget**
_Should this test itself run within a time budget (relevant to CI feasibility)?_
- (a) yes — under 30s for a single e2e spec, under 5s for a unit test file, so CI stays fast  ★ recommended — chosen
- (b) no explicit budget
- (c) must run under 1s regardless of type
- (d) not a concern

**9. Auth / access control**
_Does this test need an authenticated session/fixture user?_
- (a) yes — a seeded test user + workspace, created via the seed script or test setup, per the feature's assertion  ★ recommended — chosen
- (b) no — the tested behavior is unauthenticated
- (c) undefined
- (d) N/A

**10. Dependencies on existing code**
_What must exist before this test can run?_
- (a) every feature implementing the behavior it tests (see 'Depends on' in this feature's header) must be COMPLETE first  ★ recommended — chosen
- (b) nothing — the test can be written against unfinished code
- (c) only the migration, not the UI/action layer
- (d) undefined

## Round B - 5 follow-ups

**1. Test runner invocation**
_exactly the commands in tech-decisions.md's 'How to run tests' section — no ad hoc test-running flags_
- (a) exact documented commands  ★ recommended — chosen
- (b) worker's preferred flags
- (c) a new test script
- (d) undefined

**2. Seed data reuse**
_reuse supabase/seed.sql where it already covers the needed fixture shape; extend it rather than duplicating fixture logic per test_
- (a) extend shared seed.sql  ★ recommended — chosen
- (b) duplicate fixtures per test file
- (c) no seed data, construct via UI each time
- (d) undefined

**3. CI integration**
_this test is included in the F004 CI pipeline's test step by virtue of matching the standard test-file glob — no separate CI wiring needed_
- (a) included automatically via standard glob  ★ recommended — chosen
- (b) needs separate CI job
- (c) not run in CI, local-only
- (d) undefined

**4. Playwright browser scope**
_Chromium only for v1 (per discovery: critical paths only, not exhaustive cross-browser)_
- (a) Chromium only  ★ recommended — chosen
- (b) Chromium + Firefox + WebKit
- (c) WebKit only
- (d) undefined

**5. Test isolation from Realtime timing**
_where a test depends on a Realtime update landing, use an explicit wait-for-condition rather than a fixed sleep, to avoid flakiness_
- (a) wait-for-condition polling  ★ recommended — chosen
- (b) fixed sleep/timeout
- (c) no explicit wait, hope for the best
- (d) undefined

## Round B - 5 "definition of done"

**1. Primary success test**
_What test proves the happy path for this feature's assigned assertion(s)?_
- (a) unit test on the core function/action
- (b) integration test (DB + Server Action)
- (c) end-to-end (Playwright)
- (d) combination appropriate to the feature type (unit for pure logic, integration for Server Actions touching Supabase, e2e only for F090/F150-class interaction assertions)  ★ recommended — chosen

**2. Failure test**
_What test proves error handling / the negative case for this feature's assertion(s)?_
- (a) unit test on each error branch
- (b) integration test forcing failure (e.g. non-member calling the action)
- (c) chaos test (random failures injected)
- (d) error paths tested via the same integration test as the happy path, asserting the negative case explicitly  ★ recommended — chosen

**3. Manual verification**
_What does a human check before sign-off, if anything, for a solo-vibe-coder MVP (discovery: critical paths only)?_
- (a) none beyond the automated test — the validation contract IS the sign-off criterion  ★ recommended — chosen
- (b) a 3-step manual script in the feature spec
- (c) a live demo
- (d) checking log lines from a real run

**4. Side-effect verification**
_What should NOT happen as a result of this feature, and how is that checked?_
- (a) the test asserts no other workspace's data is mutated or returned (cross-workspace isolation), where the feature touches workspace-scoped data; otherwise N/A  ★ recommended — chosen
- (b) snapshot test of all affected tables
- (c) no explicit check
- (d) test verifies no other endpoint's behavior changes

**5. Evidence artifact**
_What proves this feature is done in the handoff/milestone report?_
- (a) test output (pass) referencing the assertion ID by name, per worker.md's test-naming convention
- (b) a screenshot or short screen recording
- (c) log lines from a real local run
- (d) all of the above where feasible; test output is the non-negotiable minimum  ★ recommended — chosen
