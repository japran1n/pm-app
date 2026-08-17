# F061 Clarification

_Generated: 2026-08-17T21:45:00Z_  _Mode: accept-and-continue_
_Answered by: orchestrator, on standing user authorization — ★ defaults taken for all 20 questions, no interactive round._

## Round A - 10 task questions

**1. Implementation pattern**
_How is this Server Action structured?_
- (a) single exported async function in the domain's lib/actions/<entity>.ts file, per tech-decisions.md file-layout convention  ★ recommended — chosen
- (b) a service class with dependency injection
- (c) a queue-triggered async handler
- (d) split across multiple action files

**2. Data shape**
_What does the action operate on?_
- (a) the row(s) as defined by the migration for this entity, no additional shape transformation  ★ recommended — chosen
- (b) a denormalized read-model
- (c) a client-supplied arbitrary shape
- (d) undefined until implementation

**3. State / storage location**
_Where does this action's result get cached/revalidated?_
- (a) Next.js `revalidatePath`/`revalidateTag` on the relevant route after mutation, per Next 16's two-arg `revalidateTag` requirement  ★ recommended — chosen
- (b) no cache invalidation — client always refetches
- (c) a custom client-side store
- (d) Redis

**4. API contract**
_What does this Server Action return on success?_
- (a) a discriminated-union result `{ ok: true, data } | { ok: false, error }` per tech-decisions.md conventions  ★ recommended — chosen
- (b) the raw Supabase client response, unwrapped
- (c) void — errors thrown and caught by an error boundary
- (d) a redirect only

**5. Failure / error handling**
_If the Supabase call inside this action fails, what happens?_
- (a) caught, logged to Sentry, returns `{ ok: false, error: <generic safe message> }` — raw DB error never surfaced to the client, per tech-decisions.md  ★ recommended — chosen
- (b) the raw Postgres error message is shown to the user
- (c) the action throws uncaught into the Client Component
- (d) silently returns success anyway

**6. Empty / zero state**
_What does this action do when its target/related record doesn't exist?_
- (a) returns `{ ok: false, error: 'not found' }`, mapped to a generic not-found in the UI (never confirms cross-workspace existence, per AS-144)  ★ recommended — chosen
- (b) throws a 500
- (c) silently no-ops and returns ok:true
- (d) undefined

**7. Validation rules**
_How is input validated before the database call?_
- (a) a Zod schema in lib/validation/<entity>.ts, matching the assigned assertion's stated constraints exactly, per AS-146  ★ recommended — chosen
- (b) validated only client-side
- (c) validated only by the DB constraint, no app-level check
- (d) not validated — trusted input

**8. Performance budget**
_Target p95 for this action under v1-scale data?_
- (a) <500ms, per discovery Q27 and AS-156 (board-data-fetch actions specifically); other CRUD actions inherit the same budget as the project-wide default  ★ recommended — chosen
- (b) <100ms
- (c) <2s
- (d) not a constraint at this stage

**9. Auth / access control**
_Who can invoke this action, and how is that checked?_
- (a) any workspace member, membership re-verified server-side at the top of the function (defense in depth per AS-143), even though RLS is the real boundary  ★ recommended — chosen
- (b) any authenticated user, no membership check
- (c) role-gated per the specific assertion's stated role restriction (owner/admin/member) — re-verified server-side, not just hidden in the UI
- (d) not access-controlled — public

**10. Dependencies on existing code**
_What does this action read or modify beyond its own table?_
- (a) reads workspace_members for the membership/role check, per the RLS pattern from F012  ★ recommended — chosen
- (b) reads only its own table
- (c) reads and writes multiple unrelated tables
- (d) requires new migrations not yet written

## Round B - 5 follow-ups

**1. Zod schema location**
_co-located in lib/validation/<entity>.ts, imported by the action, per tech-decisions.md file layout_
- (a) separate validation file  ★ recommended — chosen
- (b) inline in the action file
- (c) no schema, manual checks
- (d) shared single schema file for all entities

**2. Revalidation scope**
_revalidate exactly the routes/tags this mutation affects, not a blanket revalidation_
- (a) targeted revalidatePath/revalidateTag  ★ recommended — chosen
- (b) revalidate the whole layout
- (c) no revalidation, client refetches manually
- (d) revalidate everything defensively

**3. Optimistic UI**
_only where the feature spec explicitly calls for it (e.g. board drag F047) — most CRUD actions wait for the server response_
- (a) only where explicitly specified  ★ recommended — chosen
- (b) every action is optimistic
- (c) no action is ever optimistic
- (d) decided per worker's preference

**4. Membership check helper**
_a shared lib/auth/require-membership.ts helper, reused across all Server Actions rather than reimplemented per action_
- (a) shared helper function  ★ recommended — chosen
- (b) reimplemented inline per action
- (c) relies on RLS alone, no app-level check
- (d) checked in middleware/proxy.ts instead

**5. Error message specificity**
_generic user-facing message + full detail only in the Sentry-logged server-side error, never the reverse_
- (a) generic to user, detailed to Sentry  ★ recommended — chosen
- (b) detailed to user always
- (c) generic everywhere, no server-side detail logged
- (d) no consistent policy

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
