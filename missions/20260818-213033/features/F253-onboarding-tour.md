# F253: first-run guided tour

**Milestone:** M17 — UX polish, attachments & navigation
**Estimated worker time:** 45 minutes
**Depends on:** F252

## Assertion IDs covered
- AS-491: a first-time user is offered a short tour of sidebar, board, and task creation
- AS-492: it can be dismissed at any step and does not reappear
- AS-493: it can be replayed from the profile or help menu

## Draft scope
- Lightweight step sequence (popover anchored to a target element, 4–5 steps) built from existing primitives — no tour library.
- Completion/dismissal stored on the profile so it is per user, not per browser.
- Replay entry point in the profile menu.

## Files (approximate)
components/onboarding/tour.tsx (new), supabase/migrations/ (profiles.tour_completed_at), components/nav/app-sidebar.tsx

## Notes for clarification
- Anchoring to elements that may not exist for a guest or viewer needs a skip rule per step.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F253-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Anchoring to elements that may not exist for a guest or viewer needs a skip rule per step.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-491, AS-492, AS-493) has a named test or a written verification note.
