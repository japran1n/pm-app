# F239: dependency connectors on the timeline

**Milestone:** M16 — Views
**Estimated worker time:** 45 minutes
**Depends on:** F237, F157

## Assertion IDs covered
- AS-455: dependencies are drawn as connectors between bars

## Draft scope
- SVG overlay drawing an elbow connector from each blocking bar to its blocked bar, recomputed on scroll, zoom, and layout change.
- Connectors for off-screen partners degrade to an edge marker rather than a line into nowhere.
- Connectors are decorative for screen readers; the textual relation in the task detail remains the accessible source.

## Files (approximate)
components/timeline/dependency-overlay.tsx (new), lib/timeline/layout.ts

## Notes for clarification
- Keep the overlay in one SVG rather than one per connector, or scroll performance will suffer with many tasks.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F239-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Keep the overlay in one SVG rather than one per connector, or scroll performance will suffer with many tasks.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-455) has a named test or a written verification note.
