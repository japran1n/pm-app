# F237: timeline scale and bars

**Milestone:** M16 — Views
**Estimated worker time:** 45 minutes
**Depends on:** F236

## Assertion IDs covered
- AS-451: tasks render as bars from start to due date
- AS-452: a task without a start date renders as a single-day marker
- AS-457: today is marked with a visible line
- AS-458: horizontal scrolling does not break the layout

## Draft scope
- `/w/[workspaceSlug]/timeline`: rows of tasks against a date scale, positioned with CSS transforms over a computed pixels-per-day value — no Gantt library.
- Sticky task-name column, scrollable date area inside its own overflow container.
- Today line positioned from the user's timezone.

## Files (approximate)
app/(workspace)/w/[workspaceSlug]/timeline/page.tsx (new), components/timeline/timeline-scale.tsx (new), components/timeline/timeline-bar.tsx (new), lib/timeline/layout.ts (new)

## Notes for clarification
- Grouping rows by project or by assignee — pick a default and keep it swappable.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F237-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Grouping rows by project or by assignee — pick a default and keep it swappable.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-451, AS-452, AS-457, AS-458) has a named test or a written verification note.
