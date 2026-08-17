# F043 Clarification

_Generated: 2026-08-17T21:45:00Z_  _Mode: accept-and-continue_
_Answered by: orchestrator, on standing user authorization — ★ defaults taken for all 20 questions, no interactive round._

## Round A - 10 task questions

**1. Implementation pattern**
_How is this foundation piece structured?_
- (a) single script/config change, no abstraction  ★ recommended — chosen
- (b) service class with DI
- (c) async handler + queue
- (d) split across multiple modules

**2. Data shape**
_N/A for this feature — no domain data introduced here._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**3. State / storage location**
_Where does any config/state from this feature live?_
- (a) repo config files only (no runtime state)  ★ recommended — chosen
- (b) materialized column + trigger
- (c) Redis
- (d) client-side only

**4. Setup surface**
_What does this feature configure end-to-end?_
- (a) tooling/config only, verified by a smoke check  ★ recommended — chosen
- (b) a full running feature
- (c) a partial stub
- (d) unspecified

**5. Failure / error handling**
_If this setup step fails (e.g. a CLI command errors), what happens?_
- (a) worker sets Status BLOCKED with the exact command/error in the handoff  ★ recommended — chosen
- (b) silent retry with backoff
- (c) crash + alert
- (d) ignored, continue anyway

**6. Empty / zero state**
_N/A — infra/setup feature, no user-facing empty state._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**7. Validation rules**
_What proves this setup step succeeded?_
- (a) the exact command in 'How to run the app/tests' from tech-decisions.md exits 0  ★ recommended — chosen
- (b) manual eyeballing only
- (c) a new custom script
- (d) no validation, trust it worked

**8. Performance budget**
_N/A — one-time setup, not a runtime path with a latency budget._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**9. Auth / access control**
_N/A — infra/setup feature, not a user-facing access-controlled action._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**10. Dependencies on existing code**
_What does this feature build on?_
- (a) only this feature's own new files/config  ★ recommended — chosen
- (b) the previous M1 feature's output
- (c) tech-decisions.md conventions directly
- (d) nothing — first feature

## Round B - 5 follow-ups

**1. Tool version pinning**
_exact versions from tech-decisions.md's search-verified list, not 'latest' at install time (avoids drift mid-mission)_
- (a) pin to tech-decisions.md versions  ★ recommended — chosen
- (b) always install latest
- (c) pin only major version
- (d) no pinning policy

**2. Commit granularity**
_one commit per feature (per worker.md's feat(F<NNN>) convention), not one giant commit for all of M1_
- (a) one commit per feature  ★ recommended — chosen
- (b) one commit for the whole milestone
- (c) commit per file
- (d) no fixed policy

**3. Config file location**
_root-level config files (next.config.ts, tsconfig.json, etc.) exactly where each tool's docs specify, no custom relocation_
- (a) standard root-level locations  ★ recommended — chosen
- (b) a custom /config directory
- (c) co-located with source
- (d) undefined

**4. Placeholder content**
_M1's hello-world route contains only enough to prove SSR — no premature business UI_
- (a) minimal placeholder only  ★ recommended — chosen
- (b) a fully styled landing page already
- (c) the real dashboard, built early
- (d) undefined

**5. Turbopack vs Webpack**
_Turbopack (Next 16 default, per tech-decisions.md) — do not pass --webpack unless a real incompatibility is hit and documented_
- (a) Turbopack (default)  ★ recommended — chosen
- (b) Webpack via --webpack flag
- (c) try both, pick faster
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
