# F144: archived projects stay out of every aggregate

**Milestone:** M12 — Workspace admin, audit log & archive
**Estimated worker time:** 30 minutes
**Depends on:** F142

## Assertion IDs covered
- AS-254: archived-project tasks are excluded from dashboard, search, and My Tasks while archived

## Draft scope
- Audit every query and RPC that aggregates tasks (dashboard charts and table, overdue count, search, time totals) for the archived-project filter; mission 1 already fixed one such leak, so treat this as a systematic sweep.
- Add a shared SQL predicate or query helper so a new aggregate cannot forget the filter.
- Integration test per aggregate surface.

## Files (approximate)
supabase/migrations/ (RPC updates), lib/queries/dashboard.ts, lib/queries/search.ts, lib/queries/time-entries.ts

## Notes for clarification
- My Tasks (F230) does not exist yet — this feature defines the helper it must use.
- MCP at run: Supabase MCP for RPC updates.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: audit). Full rationale: `missions/20260818-213033/clarifications/F144-clarification.md`._

- read every file in the feature's Files scope, compare against the assigned assertions, fix in place, and list what was checked in the handoff.
- Validation: an automated test per assertion where feasible, plus a written enumeration of what was inspected for structural/negative assertions.
- Access control: only where an assigned assertion is about access; policy changes come with an RLS integration test.
- Failure handling: fix it inside this feature's file scope and record it in the handoff's Decisions Made; gaps outside scope go to Out-of-scope work needed.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - My Tasks (F230) does not exist yet — this feature defines the helper it must use.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-254) has a named test or a written verification note.
