# F266 Clarification

_Generated: 2026-08-18T21:45:00Z_  _Mode: accept-and-continue_
_Answered by: orchestrator on standing user authorization — ★ defaults taken for all 20 questions, no interactive round._
_Feature archetype: audit_

## Round A - 10 task questions

**1. Implementation pattern**
_How is this audit-and-fix carried out?_
- (a) read every file in the feature's Files scope, compare against the assigned assertions, fix in place, and list what was checked in the handoff  ★ recommended — chosen
- (b) write a new parallel module
- (c) assume compliance
- (d) lint rule only

**2. Data shape**
_Does it introduce new data?_
- (a) no — unless closing a gap genuinely requires a column or table, in which case it is added additively with RLS  ★ recommended — chosen
- (b) yes, a new schema
- (c) a cache
- (d) undefined

**3. State / storage location**
_N/A for an audit feature._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**4. API / contract**
_Does the public surface change?_
- (a) only where an assertion demands it; signatures stay stable otherwise  ★ recommended — chosen
- (b) full refactor
- (c) no changes at all even if an assertion fails
- (d) undefined

**5. Failure / error handling**
_What if a real gap is found?_
- (a) fix it inside this feature's file scope and record it in the handoff's Decisions Made; gaps outside scope go to Out-of-scope work needed  ★ recommended — chosen
- (b) open a follow-up for everything
- (c) ignore it
- (d) fail the feature

**6. Empty / zero state**
_What if the code already complies?_
- (a) say so explicitly in the handoff — 'already compliant' is a valid, documented outcome  ★ recommended — chosen
- (b) invent a change
- (c) stay silent
- (d) mark the feature failed

**7. Validation rules**
_What proves the audit is complete?_
- (a) an automated test per assertion where feasible, plus a written enumeration of what was inspected for structural/negative assertions  ★ recommended — chosen
- (b) a read-through only
- (c) an e2e test for everything
- (d) nothing

**8. Performance budget**
_N/A unless the assertion is itself about performance._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**9. Auth / access control**
_Does the audit touch policies?_
- (a) only where an assigned assertion is about access; policy changes come with an RLS integration test  ★ recommended — chosen
- (b) rewrite all policies
- (c) never touch policies
- (d) undefined

**10. Dependencies on existing code**
_How wide does it read?_
- (a) every file under the paths the feature names, plus a repo-wide grep for the specific pattern being audited  ★ recommended — chosen
- (b) the entire repo indiscriminately
- (c) one file
- (d) undefined

## Round B - 5 follow-ups

**1. Scope boundary**
_Stay inside the files the feature spec names; wider changes are reported as Out-of-scope rather than made silently._
- (a) stay in scope, report the rest  ★ recommended — chosen
- (b) expand freely
- (c) stop and wait
- (d) ignore the spec

**2. Ambiguity resolution**
_When the spec's Notes leave a choice open, take the simpler option that does not add a dependency or a second source of truth, and record the choice in the handoff's Decisions Made._
- (a) simpler option, recorded  ★ recommended — chosen
- (b) the more powerful option
- (c) ask the user
- (d) leave it unimplemented

**3. Regression protection**
_Existing mission-1 behaviour must keep passing; run the full test suite before finishing, not just the new tests._
- (a) full suite green  ★ recommended — chosen
- (b) new tests only
- (c) no tests run
- (d) suite optional

**4. Migration safety**
_Additive first: new columns/tables are backfilled and coexist with what they replace; drops happen only in the dedicated cleanup feature (F270)._
- (a) additive, drop later  ★ recommended — chosen
- (b) drop immediately
- (c) never migrate
- (d) undefined

**5. Handoff completeness**
_Every handoff section is filled, including Decisions Made, Out-of-scope work needed, and how each assigned assertion was verified._
- (a) all sections filled  ★ recommended — chosen
- (b) summary only
- (c) status line only
- (d) free-form notes

## Round B - 5 "definition of done"

**1. Primary success test**
_What proves the happy path?_
- (a) the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction  ★ recommended — chosen
- (b) always e2e
- (c) always unit
- (d) no test

**2. Failure test**
_What proves the negative case?_
- (a) an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input  ★ recommended — chosen
- (b) implicit coverage
- (c) none
- (d) manual check

**3. Manual verification**
_What does a human check?_
- (a) nothing beyond the automated tests, except for UI features, where a browser-preview screenshot at desktop and 375px is attached to the handoff  ★ recommended — chosen
- (b) a full manual script
- (c) a live demo
- (d) log reading

**4. Side-effect verification**
_What must NOT happen?_
- (a) no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries  ★ recommended — chosen
- (b) snapshot everything
- (c) no check
- (d) undefined

**5. Evidence artifact**
_What proves it is done?_
- (a) passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features  ★ recommended — chosen
- (b) a screenshot alone
- (c) logs alone
- (d) the worker's word
