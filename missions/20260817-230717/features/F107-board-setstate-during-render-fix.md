# F107: board setState during render fix

**Milestone:** M8 — Final polish (follow-up)
**Estimated worker time:** 15 minutes
**Depends on:** F102
**Parent:** F102

## Assertion IDs covered
- (none — code quality/correctness cleanup, not tied to a specific assertion; prevents a React anti-pattern that could cause subtle rendering bugs)

## Draft scope
- M8-scrutiny.md's final Playwright run surfaced a React "setState during render" console warning in components/board/board.tsx's reorderTask call path — a legitimate React anti-pattern (calling a state setter synchronously during another component's render phase, rather than in an effect or event handler) that didn't fail the test but risks subtle bugs (double-renders, inconsistent state) under React's concurrent rendering.
- Fix: trace the exact call path (likely in the optimistic-update/rollback logic from F047/F102) and move the offending setState call into the correct lifecycle point — typically wrapping it in a startTransition, moving it out of a render-phase callback into an event handler or useEffect, or deferring it appropriately.
- Add/confirm a test proving no React warning is logged during a normal drag-and-drop flow.

## Files (approximate)
components/board/board.tsx

## Notes for clarification
Source: M8-scrutiny.md, final gate run finding. Severity: low (didn't fail tests, but a real anti-pattern worth closing out before calling the mission done).
