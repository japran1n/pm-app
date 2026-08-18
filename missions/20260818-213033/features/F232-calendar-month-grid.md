# F232: calendar month grid

**Milestone:** M16 — Views
**Estimated worker time:** 45 minutes
**Depends on:** F124

## Assertion IDs covered
- AS-442: tasks appear on their due dates in a month grid
- AS-443: previous/next month and jump-to-today
- AS-450: dates are computed in the user's timezone

## Draft scope
- CSS-grid month view built on `date-fns` (no calendar library), one cell per day, with tasks rendered as compact chips carrying key, title, and assignee avatar.
- Month navigation via URL search param so the view is linkable and server-rendered.
- Week start derived from the locale, stated explicitly.

## Files (approximate)
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx (new), components/calendar/month-grid.tsx (new), components/calendar/day-cell.tsx (new), lib/queries/calendar.ts (new)

## Notes for clarification
- Scope: workspace-wide with a project filter, or per project? Workspace-wide is the more useful default.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F232-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Scope: workspace-wide with a project filter, or per project? Workspace-wide is the more useful default.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-442, AS-443, AS-450) has a named test or a written verification note.
