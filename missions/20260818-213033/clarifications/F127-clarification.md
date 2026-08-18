# F127 Clarification

_Generated: 2026-08-18T21:45:00Z_  _Mode: accept-and-continue_
_Answered by: orchestrator on standing user authorization — ★ defaults taken for all 20 questions, no interactive round._
_Feature archetype: logic_

## Round A - 10 task questions

**1. Implementation pattern**
_How is this logic packaged?_
- (a) a pure, side-effect-free module under lib/ with an explicit exported API, unit-tested independently of React and Supabase  ★ recommended — chosen
- (b) inline inside a component
- (c) duplicated at each call site
- (d) a class hierarchy

**2. Data shape**
_What does it operate on?_
- (a) plain typed inputs passed by the caller — no I/O inside the module, no implicit globals such as the current time or timezone  ★ recommended — chosen
- (b) raw database rows fetched internally
- (c) untyped objects
- (d) global state

**3. State / storage location**
_Does it hold state?_
- (a) no; any persistence is done by the caller (a Server Action or a scheduled SQL function)  ★ recommended — chosen
- (b) module-level mutable state
- (c) localStorage
- (d) a cache

**4. API / contract**
_What is the exported surface?_
- (a) small named functions with explicit return types, including the null/none case where the domain has one  ★ recommended — chosen
- (b) one large do-everything function
- (c) default export of an object
- (d) undefined

**5. Failure / error handling**
_How are invalid inputs treated?_
- (a) invalid input returns a typed error or null rather than throwing, and the caller decides how to surface it  ★ recommended — chosen
- (b) throws
- (c) silently returns a wrong value
- (d) undefined behaviour

**6. Empty / zero state**
_What is returned for an empty input?_
- (a) an explicit empty/none result that callers must handle — never a misleading zero  ★ recommended — chosen
- (b) zero
- (c) null with no type
- (d) an exception

**7. Validation rules**
_How is correctness proven?_
- (a) unit tests per assertion, including the boundary cases the feature spec names (DST, month-end, concurrency, actor exclusion, overflow)  ★ recommended — chosen
- (b) one happy-path test
- (c) no tests
- (d) manual reasoning

**8. Performance budget**
_What complexity is acceptable?_
- (a) linear in the input the caller already holds; no hidden queries, no unbounded recursion  ★ recommended — chosen
- (b) whatever works
- (c) exponential acceptable
- (d) undefined

**9. Auth / access control**
_Does it enforce permissions?_
- (a) no — it is pure; permission checks stay in the action layer that calls it, so both cannot drift  ★ recommended — chosen
- (b) yes, internally
- (c) partially
- (d) undefined

**10. Dependencies on existing code**
_What may it import?_
- (a) date-fns and existing lib/ helpers only; never React, never the Supabase client  ★ recommended — chosen
- (b) anything
- (c) a new dependency
- (d) unknown

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
