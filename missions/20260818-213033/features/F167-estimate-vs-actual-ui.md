# F167: estimate vs logged time on the task

**Milestone:** M13 — Task identity, structure & relations
**Estimated worker time:** 30 minutes
**Depends on:** F166

## Assertion IDs covered
- AS-300: the detail view shows estimate against actual
- AS-301: over-estimate tasks are visibly flagged
- AS-302: a task with no estimate shows logged time only, with no flag

## Draft scope
- Extend `components/task/time-tracking.tsx` with an estimate row, a progress bar of logged/estimate, and an over-estimate badge (icon + text).
- The badge appears on the task card too, matching the overdue indicator's visual language.
- Unit test for the ratio/flag helper including the null-estimate case.

## Files (approximate)
components/task/time-tracking.tsx, components/task/task-card.tsx, lib/time/estimate-progress.ts (new)

## Notes for clarification
- Over-estimate is a fact, not an error — the styling should inform, not alarm.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F167-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Over-estimate is a fact, not an error — the styling should inform, not alarm.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-300, AS-301, AS-302) has a named test or a written verification note.
