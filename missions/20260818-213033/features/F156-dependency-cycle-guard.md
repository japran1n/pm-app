# F156: reject dependency cycles

**Milestone:** M13 — Task identity, structure & relations
**Estimated worker time:** 45 minutes
**Depends on:** F155

## Assertion IDs covered
- AS-278: a dependency that would create a cycle is rejected, naming the conflict

## Draft scope
- Recursive CTE in the insert path detecting whether the proposed edge closes a cycle, run inside the same transaction as the insert so a concurrent insert cannot slip through.
- Error message names the task that would close the loop (its key and title).
- Unit test for the path-finding helper plus an integration test for a three-task cycle and a concurrent double-insert.

## Files (approximate)
supabase/migrations/ (RPC), lib/actions/dependencies.ts (new), tests/integration/dependency-cycle.test.ts (new)

## Notes for clarification
- Cycle detection in application code alone is a TOCTOU bug — the check belongs in the same statement/transaction as the write.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: audit). Full rationale: `missions/20260818-213033/clarifications/F156-clarification.md`._

- read every file in the feature's Files scope, compare against the assigned assertions, fix in place, and list what was checked in the handoff.
- Validation: an automated test per assertion where feasible, plus a written enumeration of what was inspected for structural/negative assertions.
- Access control: only where an assigned assertion is about access; policy changes come with an RLS integration test.
- Failure handling: fix it inside this feature's file scope and record it in the handoff's Decisions Made; gaps outside scope go to Out-of-scope work needed.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Cycle detection in application code alone is a TOCTOU bug — the check belongs in the same statement/transaction as the write.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-278) has a named test or a written verification note.
