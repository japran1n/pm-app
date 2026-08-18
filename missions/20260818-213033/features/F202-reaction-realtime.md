# F202: live reactions

**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Estimated worker time:** 30 minutes
**Depends on:** F201

## Assertion IDs covered
- AS-369: reactions appear live for other viewers without a reload

## Draft scope
- Subscribe to `comment_reactions` changes for the open task, reconciling into the comment list state the same way `use-comments-realtime.ts` does.
- Guard against echoing the caller's own optimistic update twice.
- Playwright test with two browser contexts asserting the second sees the first's reaction.

## Files (approximate)
components/task/use-reactions-realtime.ts (new), lib/tasks/subscribe-comments-realtime.ts, tests/e2e/reactions.spec.ts (new)

## Notes for clarification
- Mission 1's realtime ordering guard (F103) is the precedent for out-of-order payload handling.
- MCP at run: Supabase MCP for publication verification.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F202-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Mission 1's realtime ordering guard (F103) is the precedent for out-of-order payload handling.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-369) has a named test or a written verification note.
