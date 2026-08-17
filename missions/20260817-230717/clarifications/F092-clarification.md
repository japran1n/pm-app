# F092 Clarification

_Generated: 2026-08-17T21:45:00Z_  _Mode: accept-and-continue_
_Answered by: orchestrator, on standing user authorization — ★ defaults taken for all 20 questions, no interactive round._

## Round A - 10 task questions

**1. Implementation pattern**
_How is the README structured?_
- (a) standard sections: overview, prerequisites, setup, run, test, env vars, per discovery Q30 'README + API docs'  ★ recommended — chosen
- (b) a single unstructured paragraph
- (c) auto-generated from code comments only
- (d) a link to external docs only, no inline content

**2. Data shape**
_N/A — documentation feature._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**3. State / storage location**
_N/A — documentation feature._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**4. Content scope**
_What must the README cover, at minimum?_
- (a) exactly what AS-159 requires: how to run locally, how to run tests, and every required environment variable with a one-line description each  ★ recommended — chosen
- (b) a marketing-style project description only
- (c) full API reference for every Server Action
- (d) full user-facing manual

**5. Failure / error handling**
_N/A — documentation feature._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**6. Empty / zero state**
_N/A — documentation feature._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**7. Validation rules**
_How is README accuracy verified before this feature is marked COMPLETE?_
- (a) worker actually runs the documented commands (`npm install`, dev, test, lint, typecheck) and confirms they match tech-decisions.md exactly  ★ recommended — chosen
- (b) not verified, trust the prose
- (c) verified by a separate reviewer only
- (d) not applicable

**8. Performance budget**
_N/A — documentation feature._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**9. Auth / access control**
_N/A — documentation feature._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**10. Dependencies on existing code**
_What does the README need to accurately reflect?_
- (a) the actual final state of tech-decisions.md's run/test/lint/typecheck commands and .env.example's key list, both re-checked at write time  ★ recommended — chosen
- (b) the original draft plan only, not re-checked against final state
- (c) nothing — generic boilerplate
- (d) undefined

## Round B - 5 follow-ups

**1. Env var documentation format**
_a table or list: variable name, one-line purpose, where to obtain it (mirrors .env.example ordering)_
- (a) table/list matching .env.example order  ★ recommended — chosen
- (b) prose paragraph
- (c) no per-variable detail, link to provider docs only
- (d) undefined

**2. Setup command accuracy**
_copy commands verbatim from tech-decisions.md, not re-typed from memory_
- (a) verbatim from tech-decisions.md  ★ recommended — chosen
- (b) re-typed from memory
- (c) abbreviated versions only
- (d) undefined

**3. Target audience**
_the user themselves, returning to their own project after time away (solo vibe-coder MVP) — not a public open-source audience_
- (a) future-self / solo maintainer  ★ recommended — chosen
- (b) public open-source contributors
- (c) enterprise onboarding doc
- (d) undefined

**4. Scope of what's documented**
_setup + run + test + env vars only, per AS-159 — not a full architecture doc (that's tech-decisions.md's job)_
- (a) setup/run/test/env only  ★ recommended — chosen
- (b) full architecture walkthrough
- (c) API reference for every action
- (d) undefined

**5. Placement of Known Limitations**
_a short section noting v1-scope exclusions (Timeline/Gantt, multi-assignee, i18n) so future-self isn't surprised_
- (a) short Known Limitations section  ★ recommended — chosen
- (b) no limitations section
- (c) a separate ROADMAP.md file
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
