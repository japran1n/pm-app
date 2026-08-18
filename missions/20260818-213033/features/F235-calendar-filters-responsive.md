# F235: calendar filters and small screens

**Milestone:** M16 — Views
**Estimated worker time:** 30 minutes
**Depends on:** F233

## Assertion IDs covered
- AS-448: the calendar respects active filters such as assignee
- AS-449: it renders usably on a phone-width viewport

## Draft scope
- Reuse the list-view filter components (assignee, priority, project, tag) bound to the same URL params.
- Phone layout switches from a 7-column grid to an agenda list grouped by day, rather than shrinking cells into unreadability.
- Filters persist when changing month.

## Files (approximate)
components/calendar/calendar-filters.tsx (new), components/calendar/agenda-list.tsx (new), app/(workspace)/w/[workspaceSlug]/calendar/page.tsx

## Notes for clarification
- The agenda fallback is a different component, not CSS trickery on the grid.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F235-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The agenda fallback is a different component, not CSS trickery on the grid.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-448, AS-449) has a named test or a written verification note.
