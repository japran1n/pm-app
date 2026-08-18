# F226: collapse lanes and remember the grouping

**Milestone:** M16 — Views
**Estimated worker time:** 30 minutes
**Depends on:** F224

## Assertion IDs covered
- AS-422: a collapsed lane stays collapsed across reloads
- AS-424: the chosen grouping persists per user per project

## Draft scope
- Migration: `user_board_prefs` (user_id, project_id, grouping, collapsed_lanes jsonb) with own-row RLS — or a documented decision to use localStorage instead.
- Collapse toggles per lane with a visible count of hidden tasks.
- Preference loads server-side so the first paint is already correct.

## Files (approximate)
supabase/migrations/ (new), lib/actions/board-prefs.ts (new), components/board/swimlane.tsx

## Notes for clarification
- Server-side persistence beats localStorage for cross-device consistency but costs a write per toggle; pick one deliberately.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F226-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Server-side persistence beats localStorage for cross-device consistency but costs a write per toggle; pick one deliberately.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-422, AS-424) has a named test or a written verification note.
