# F187: bulk delete with partial-failure reporting

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 30 minutes
**Depends on:** F186

## Assertion IDs covered
- AS-339: bulk delete after a confirmation naming the count
- AS-340: partial failure reports which tasks failed and keeps the rest applied

## Draft scope
- Soft-delete action over the selection, returning a per-id result so the UI can report "12 deleted, 2 failed" with the failures named by task key.
- Confirmation dialog stating the count and that items go to trash, not oblivion.
- Integration test forcing a mid-list failure.

## Files (approximate)
lib/actions/tasks.ts, components/task/bulk-action-bar.tsx

## Notes for clarification
- Mission 1's optimistic-rollback-partial-failure fix (F102) is the precedent for how partial failures are surfaced — follow it.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F187-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Mission 1's optimistic-rollback-partial-failure fix (F102) is the precedent for how partial failures are surfaced — follow it.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-339, AS-340) has a named test or a written verification note.
