# F165 Clarification

_Generated: 2026-08-18T21:45:00Z_  _Mode: accept-and-continue_
_Answered by: orchestrator on standing user authorization — ★ defaults taken for all 20 questions, no interactive round._
_Feature archetype: action_

## Round A - 10 task questions

**1. Implementation pattern**
_How is this mutation implemented?_
- (a) a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary  ★ recommended — chosen
- (b) a route handler
- (c) a client-side Supabase call
- (d) a database trigger only

**2. Data shape**
_What input does it accept?_
- (a) a narrow, explicitly typed input object validated by a Zod schema in lib/validation/, mirroring the DB constraints  ★ recommended — chosen
- (b) free-form FormData with no schema
- (c) the whole entity row
- (d) untyped any

**3. State / storage location**
_Where does resulting state live?_
- (a) Postgres via Supabase, with revalidatePath/revalidateTag refreshing the affected routes  ★ recommended — chosen
- (b) client state only
- (c) local storage
- (d) a cache with no invalidation

**4. API / contract**
_What does the caller get back?_
- (a) the discriminated-union result plus the minimum data the UI needs to reconcile optimistically  ★ recommended — chosen
- (b) void
- (c) the raw Supabase response
- (d) a thrown exception on failure

**5. Failure / error handling**
_How are failures surfaced?_
- (a) expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error  ★ recommended — chosen
- (b) raw errors shown to the user
- (c) silent failure
- (d) retry loop

**6. Empty / zero state**
_What happens on a no-op input?_
- (a) a no-op returns ok without writing, and the UI shows no error toast for an intentional no-op  ★ recommended — chosen
- (b) an error is raised
- (c) an empty row is written
- (d) undefined

**7. Validation rules**
_What is validated and where?_
- (a) Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate  ★ recommended — chosen
- (b) client-side only
- (c) database only
- (d) no validation

**8. Performance budget**
_How many round trips may it make?_
- (a) one statement or one RPC for the whole mutation where atomicity matters; never a per-row loop of network calls  ★ recommended — chosen
- (b) a query per row
- (c) unbounded
- (d) undefined

**9. Auth / access control**
_Who may call it?_
- (a) re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it  ★ recommended — chosen
- (b) trusted from the client
- (c) anyone signed in
- (d) unchecked

**10. Dependencies on existing code**
_What may it modify?_
- (a) only the files named in the feature's Files section plus their direct validation schemas; anything wider goes to Out-of-scope in the handoff  ★ recommended — chosen
- (b) any file
- (c) a broad refactor
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
