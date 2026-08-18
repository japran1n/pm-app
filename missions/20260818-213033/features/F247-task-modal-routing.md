# F247: open tasks as an intercepted route

**Milestone:** M17 — UX polish
**Estimated worker time:** 45 minutes
**Depends on:** F246

## Assertion IDs covered
- AS-475: opening from the board updates the URL without a full reload
- AS-476: closing returns to the previous view with scroll and filters preserved
- AS-477 (shared): access rules identical in both entry paths
- AS-478: browser back closes the task rather than leaving the app

## Draft scope
- Next.js intercepting/parallel routes so the board and list render the task in a sheet over the current view while the URL is the deep link.
- Close uses `router.back()` when the task was opened in-app, and falls back to the project view when it was a direct load.
- Scroll position and filter params survive open/close.

## Files (approximate)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/@modal/(.)tasks/[taskKey]/page.tsx (new), components/task/task-detail-sheet.tsx, components/task/use-task-detail-sheet.ts

## Notes for clarification
- Intercepting routes are the trickiest Next.js feature in this mission; verify behaviour under a hard refresh, back, and forward.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F247-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Intercepting routes are the trickiest Next.js feature in this mission; verify behaviour under a hard refresh, back, and forward.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-475, AS-476, AS-477, AS-478) has a named test or a written verification note.
