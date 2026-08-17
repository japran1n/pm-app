# F083 Clarification

_Generated: 2026-08-17T21:45:00Z_  _Mode: accept-and-continue_
_Answered by: orchestrator, on standing user authorization — ★ defaults taken for all 20 questions, no interactive round._

## Round A - 10 task questions

**1. Implementation pattern**
_How is this audit-and-fix feature carried out?_
- (a) read every file listed in 'Files (approximate)', identify gaps against the assigned assertions, fix in place — no new files unless a genuine gap requires one  ★ recommended — chosen
- (b) write an entirely new module duplicating existing logic
- (c) skip reading existing code, just add new validation on top
- (d) delegate to a lint rule only, no manual review

**2. Data shape**
_N/A — audit feature, not introducing new data shapes._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**3. State / storage location**
_N/A — audit feature._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**4. Scope of the audit**
_What's in scope for this pass?_
- (a) exactly the files/pattern named in 'Files (approximate)' on the feature spec — not a repo-wide rewrite  ★ recommended — chosen
- (b) the entire repository regardless of relevance
- (c) only files touched by the single most recent feature
- (d) undefined, worker's discretion with no boundary

**5. Failure / error handling**
_If the audit finds a real gap against an assigned assertion, what happens?_
- (a) fix it directly as part of this feature (it's explicitly an audit-AND-fix feature) and note the fix in the handoff's Decisions Made section  ★ recommended — chosen
- (b) open a new follow-up feature instead of fixing now
- (c) ignore it and mark the assertion PASS anyway
- (d) fail the feature entirely and do nothing

**6. Empty / zero state**
_N/A — audit feature._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**7. Validation rules**
_What proves the audit is complete and the assertions now hold?_
- (a) a passing automated test per assertion where one is feasible, plus a written note in the handoff for assertions that are structural/negative-only (e.g. 'no X exists')  ★ recommended — chosen
- (b) informal read-through only, no test added
- (c) a new end-to-end test for every single assertion regardless of feasibility
- (d) no verification, trust the read-through

**8. Performance budget**
_N/A unless the audit's specific assertion is itself a performance assertion (e.g. F089)._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**9. Auth / access control**
_N/A unless the audit's specific assertion concerns access control directly (several of M8's do — follow that assertion's own stated boundary)._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**10. Dependencies on existing code**
_What does this audit read across?_
- (a) every file under the path(s) named in 'Files (approximate)' for this feature  ★ recommended — chosen
- (b) the whole repository unconditionally
- (c) only files changed in the single most recent commit
- (d) undefined

## Round B - 5 follow-ups

**1. Fix vs flag threshold**
_fix directly if the gap is small and clearly scoped to this feature's assertion; flag as a new follow-up feature only if it requires touching unrelated code_
- (a) fix small gaps directly, flag large ones  ★ recommended — chosen
- (b) always fix, never flag
- (c) always flag, never fix directly
- (d) worker's unstructured discretion

**2. False-positive handling**
_if the audit finds the assertion already holds, document that explicitly in the handoff rather than silently doing nothing_
- (a) document 'already compliant' explicitly  ★ recommended — chosen
- (b) say nothing if already compliant
- (c) invent a change anyway to show work
- (d) undefined

**3. Cross-feature gaps**
_if the audit surfaces a gap that belongs to a different, already-COMPLETE feature, note it as Out-of-scope work needed rather than fixing silently outside this feature's file scope_
- (a) note as Out-of-scope, don't silently expand scope  ★ recommended — chosen
- (b) fix it silently regardless of scope
- (c) ignore it
- (d) block this feature on it

**4. Tooling used for the audit**
_grep/read plus the project's own eslint/tsc for the mechanical parts (F093 specifically); other audits are manual code review guided by the assertion text_
- (a) manual review + existing lint/typecheck tooling  ★ recommended — chosen
- (b) a new custom static-analysis script
- (c) AI-only judgment, no tooling
- (d) undefined

**5. Re-audit trigger**
_if a later milestone's feature reintroduces a gap this audit closed, that's caught by the next milestone's scrutiny-validator pass, not by re-running this feature_
- (a) rely on scrutiny-validator for regressions  ★ recommended — chosen
- (b) re-run every audit feature after every later feature
- (c) no regression protection
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
