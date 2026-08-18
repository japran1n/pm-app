# F164: watch, unwatch, and auto-watch

**Milestone:** M13 — Task identity, structure & relations
**Estimated worker time:** 30 minutes
**Depends on:** F163

## Assertion IDs covered
- AS-295: commenting on a task adds the commenter as a watcher
- AS-296: unwatching stops that task's notifications

## Draft scope
- `watchTask` / `unwatchTask` actions; the comment action adds a watcher row idempotently.
- Unwatch is durable: a later comment by the same user re-adds them only if they have not explicitly unwatched since (decide the rule, then encode it).
- Integration tests for both paths.

## Files (approximate)
lib/actions/watchers.ts (new), lib/actions/comments.ts, lib/validation/watchers.ts (new)

## Notes for clarification
- The simplest coherent rule: auto-watch on comment, explicit unwatch wins until the user acts again. Confirm before implementing.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F164-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The simplest coherent rule: auto-watch on comment, explicit unwatch wins until the user acts again. Confirm before implementing.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-295, AS-296) has a named test or a written verification note.
