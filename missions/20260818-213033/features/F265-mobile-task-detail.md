# F265: task detail on phones

**Milestone:** M17 — UX polish, attachments & navigation
**Estimated worker time:** 30 minutes
**Depends on:** F264

## Assertion IDs covered
- AS-516: the task detail is full-screen on phone widths
- AS-518: mobile navigation tap targets are at least 44px

## Draft scope
- Sheet switches to a full-screen presentation below the tablet breakpoint, with a sticky header carrying the task key and close control.
- Sections (description, checklist, subtasks, comments, activity, time) become collapsible so the screen is navigable.
- Audit sidebar/sheet/menu triggers for touch size.

## Files (approximate)
components/task/task-detail-sheet.tsx, components/ui/sheet.tsx, components/nav/app-sidebar.tsx

## Notes for clarification
- Full-screen presentation interacts with the intercepted route (F247) — verify back-button behaviour on mobile too.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F265-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Full-screen presentation interacts with the intercepted route (F247) — verify back-button behaviour on mobile too.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-516, AS-518) has a named test or a written verification note.
