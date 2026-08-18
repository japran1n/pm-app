# F139 Clarification

_Generated: 2026-08-18T21:45:00Z_  _Mode: accept-and-continue_
_Answered by: orchestrator on standing user authorization — ★ defaults taken for all 20 questions, no interactive round._
_Feature archetype: db_

## Round A - 10 task questions

**1. Implementation pattern**
_How does this schema change land?_
- (a) a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers  ★ recommended — chosen
- (b) hand-edited SQL run in the dashboard
- (c) an ORM migration tool added for this purpose
- (d) direct table edits via the Supabase UI

**2. Data shape**
_What shape does the new data take?_
- (a) exactly the columns named in the feature's Draft scope, snake_case, uuid PKs, timestamptz created_at/updated_at, nullable only where the spec says nullable  ★ recommended — chosen
- (b) a single jsonb blob column
- (c) denormalised copies of existing columns
- (d) whatever the worker finds convenient

**3. State / storage location**
_Where does this state live?_
- (a) Postgres, inside the existing Supabase project, with RLS enabled in the same migration  ★ recommended — chosen
- (b) client-side state only
- (c) a new external store
- (d) an in-memory cache

**4. API / contract**
_How does application code reach it?_
- (a) through the generated Supabase types plus Server Actions in lib/actions/, never a raw client query from a component  ★ recommended — chosen
- (b) direct fetch calls from components
- (c) a new REST layer
- (d) an RPC per column

**5. Failure / error handling**
_What happens when a write violates a constraint?_
- (a) the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result  ★ recommended — chosen
- (b) the error is swallowed
- (c) a generic 500 reaches the user
- (d) the constraint is omitted so nothing can fail

**6. Empty / zero state**
_What does the table look like on day one?_
- (a) empty is a valid state; every reader handles zero rows without erroring, and backfills named in the spec run in the same migration  ★ recommended — chosen
- (b) seed dummy rows
- (c) assume at least one row always exists
- (d) undefined

**7. Validation rules**
_Where are the invariants enforced?_
- (a) in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line  ★ recommended — chosen
- (b) Zod only
- (c) the UI only
- (d) nowhere

**8. Performance budget**
_What are the index requirements?_
- (a) index every FK and every column named in a WHERE/ORDER BY of the queries this feature enables; verify with the query plan for the main read path  ★ recommended — chosen
- (b) no indexes initially
- (c) index every column
- (d) undefined

**9. Auth / access control**
_How is access scoped?_
- (a) RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate  ★ recommended — chosen
- (b) application checks only
- (c) service-role access from the server
- (d) public read

**10. Dependencies on existing code**
_What existing code does this touch?_
- (a) lib/supabase/database.types.ts must be regenerated; existing policies are extended, not replaced, unless the spec says otherwise  ★ recommended — chosen
- (b) nothing else
- (c) a full schema rewrite
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
