# F152: checklist item actions

**Milestone:** M13 — Task identity, structure & relations
**Estimated worker time:** 30 minutes
**Depends on:** F151

## Assertion IDs covered
- AS-270: toggling persists immediately and survives reload
- AS-271: an item can be renamed, reordered, and deleted

## Draft scope
- Server Actions: add, toggle, rename, reorder (fractional index), delete — each Zod-validated and permission-checked via F127.
- Reorder reuses `lib/board/position.ts` including its bound-safety fix from mission 1.
- Unit tests for the position maths reuse and integration tests for toggle persistence.

## Files (approximate)
lib/actions/checklist.ts (new), lib/validation/checklist.ts (new), lib/board/position.ts

## Notes for clarification
- Toggle is the highest-frequency mutation in this feature; it must be optimistic (F256's conventions).
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F152-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Toggle is the highest-frequency mutation in this feature; it must be optimistic (F256's conventions).

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-270, AS-271) has a named test or a written verification note.
