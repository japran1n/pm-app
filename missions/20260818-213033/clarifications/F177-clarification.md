# F177 Clarification

_Generated: 2026-08-18T21:45:00Z_  _Mode: accept-and-continue_
_Answered by: orchestrator on standing user authorization — ★ defaults taken for all 20 questions, no interactive round._
_Feature archetype: ui_

## Round A - 10 task questions

**1. Implementation pattern**
_How is this UI built?_
- (a) Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system  ★ recommended — chosen
- (b) a new component library
- (c) inline styles
- (d) copy-pasted markup per usage

**2. Data shape**
_Where does its data come from?_
- (a) server-fetched in the page/layout and passed down as typed props; client components never query Supabase directly for initial render  ★ recommended — chosen
- (b) client-side fetching on mount
- (c) a global store
- (d) prop drilling from unrelated parents

**3. State / storage location**
_Where does view state live?_
- (a) URL search params for anything shareable (filters, sort, view, month, zoom); local component state for ephemeral UI only  ★ recommended — chosen
- (b) a global client store
- (c) localStorage for everything
- (d) server session

**4. API / contract**
_How does it mutate data?_
- (a) by calling the existing Server Actions with optimistic UI and rollback on failure, per the project's established pattern  ★ recommended — chosen
- (b) direct database writes
- (c) a new API route
- (d) no mutation

**5. Failure / error handling**
_What does the user see when something fails?_
- (a) the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state  ★ recommended — chosen
- (b) a blank screen
- (c) a raw error string
- (d) nothing

**6. Empty / zero state**
_What renders with no data?_
- (a) the shared EmptyState pattern: what this view is for, plus its primary action when the user has permission to take it  ★ recommended — chosen
- (b) a blank area
- (c) a spinner forever
- (d) the string 'No data'

**7. Validation rules**
_How is input validated?_
- (a) client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone  ★ recommended — chosen
- (b) client only
- (c) server only, no feedback
- (d) none

**8. Performance budget**
_What is the render cost boundary?_
- (a) no N+1 queries per row and no per-item network call; counts and related data arrive with the main query  ★ recommended — chosen
- (b) one query per rendered item
- (c) unbounded
- (d) undefined

**9. Auth / access control**
_What does a user without rights see?_
- (a) controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call  ★ recommended — chosen
- (b) controls shown and failing
- (c) everything enabled
- (d) undefined

**10. Dependencies on existing code**
_What existing components does it reuse?_
- (a) the existing primitives and patterns named in the feature spec (avatar, empty state, inline cell, position maths, realtime reconcilers) rather than new parallel implementations  ★ recommended — chosen
- (b) new bespoke versions of each
- (c) none
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
