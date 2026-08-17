# F025 Clarification

_Generated: 2026-08-17T21:45:00Z_  _Mode: accept-and-continue_
_Answered by: orchestrator, on standing user authorization — ★ defaults taken for all 20 questions, no interactive round._

## Round A - 10 task questions

**1. Implementation pattern**
_How is the migration structured?_
- (a) one SQL file per feature, forward-only, in supabase/migrations/  ★ recommended — chosen
- (b) one giant migration for the whole schema
- (c) ORM-generated migration
- (d) hand-written down-migration pairs

**2. Data shape**
_What's the canonical representation for this table's core relationship?_
- (a) FK column + CHECK constraint where the contract specifies a fixed set of values  ★ recommended — chosen
- (b) JSONB blob
- (c) denormalized array on parent
- (d) derived view only, no base table

**3. Rollback strategy**
_If this migration needs to be reverted after being applied to the linked project, how?_
- (a) a hand-written down-migration in the same PR, applied via `supabase db reset` in dev  ★ recommended — chosen
- (b) no rollback — forward-fix only
- (c) automatic via Supabase branching
- (d) not applicable — no schema changes possible once shipped

**4. Data-loss tolerance**
_Can this migration be applied to a database with existing rows without data loss?_
- (a) yes — additive only (new table/column with safe defaults)  ★ recommended — chosen
- (b) yes but requires a backfill step, documented in the handoff
- (c) no — destructive, requires a maintenance window (flag in handoff if so)
- (d) not applicable — this is the first migration touching this table

**5. Failure / error handling**
_If `supabase db push` fails against the linked project, what happens?_
- (a) worker sets Status BLOCKED, includes the exact psql/CLI error in Blockers  ★ recommended — chosen
- (b) worker retries with a different migration silently
- (c) worker marks COMPLETE anyway and notes it in Out-of-scope
- (d) worker deletes the migration file and tries a different approach without documenting why

**6. Empty / zero state**
_What does an empty (zero-row) version of this table look like to the app?_
- (a) a valid empty result set — every consumer must handle zero rows gracefully  ★ recommended — chosen
- (b) impossible — seed data guarantees at least one row
- (c) not applicable to a schema-only feature
- (d) undefined

**7. Validation rules**
_Where is the primary validation enforced for this table's constrained columns?_
- (a) database CHECK constraint, per tech-decisions.md's 'status/priority modeled as CHECK constraint' decision  ★ recommended — chosen
- (b) app-code validation only
- (c) both DB CHECK and a native Postgres enum type
- (d) no validation, trust the Server Action layer alone

**8. Performance budget**
_N/A at the schema level — covered by feature-level p95 budgets (AS-156) elsewhere, not per-migration._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**9. Auth / access control**
_N/A here — RLS policy authorship is its own separate feature in every case this mission defines it as such._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**10. Dependencies on existing code**
_What does this migration build on?_
- (a) the workspace_members RLS join pattern established in F012, replicated for this table  ★ recommended — chosen
- (b) a brand-new isolated pattern
- (c) the reference app's original Prisma schema directly (not applicable — this is a rebuild)
- (d) no dependency — root table

## Round B - 5 follow-ups

**1. Column naming**
_snake_case columns matching Supabase's generated-types convention, per tech-decisions.md Conventions_
- (a) snake_case  ★ recommended — chosen
- (b) camelCase
- (c) PascalCase
- (d) mixed, decided per column

**2. Index strategy**
_add an index on any FK/lookup column this table's RLS policy will join through_
- (a) yes, index FK/RLS-join columns  ★ recommended — chosen
- (b) no indexes beyond the primary key
- (c) index every column defensively
- (d) decide later, not part of this feature

**3. Timestamp defaults**
_created_at/updated_at (where applicable) default to now() at the DB level, not app code_
- (a) DB-level default now()  ★ recommended — chosen
- (b) set from app code on every write
- (c) nullable, set manually per row
- (d) not applicable to this table

**4. Soft-delete filter placement**
_deleted_at IS NULL filtering happens in RLS policies (not just app queries), per tech-decisions.md Conventions_
- (a) enforced in RLS  ★ recommended — chosen
- (b) enforced only in app-level queries
- (c) enforced in both, redundantly
- (d) not applicable — table has no soft delete

**5. Migration file naming**
_sequential numeric prefix + descriptive slug, Supabase CLI convention (supabase migration new <name>)_
- (a) CLI-generated timestamp prefix + slug  ★ recommended — chosen
- (b) manual numeric prefix
- (c) no prefix, slug only
- (d) not applicable

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
