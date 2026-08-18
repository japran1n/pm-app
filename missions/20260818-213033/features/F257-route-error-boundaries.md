# F257: route-level error boundaries

**Milestone:** M17 — UX polish
**Estimated worker time:** 30 minutes
**Depends on:** F255

## Assertion IDs covered
- AS-500: an error in one view does not blank the whole app shell

## Draft scope
- `error.tsx` per route segment rendering inside the workspace shell, with a retry action and a plain-language message — never a raw stack trace.
- A global `app/error.tsx` fallback for the shell itself.
- No external error-reporting service: out of scope for this mission by the user's decision.

## Files (approximate)
app/(workspace)/w/[workspaceSlug]/**/error.tsx (new), app/error.tsx (new)

## Notes for clarification
- Retry must actually re-run the failed fetch, not just re-render the same failed state.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F257-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Retry must actually re-run the failed fetch, not just re-render the same failed state.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-500) has a named test or a written verification note.
