# F251: inline edit permissions and live updates

**Milestone:** M17 — UX polish
**Estimated worker time:** 30 minutes
**Depends on:** F250

## Assertion IDs covered
- AS-486: a permission-rejected edit reverts to the server value
- AS-488: another user's edit appears live
- AS-489: inline controls are not rendered for users without edit rights

## Draft scope
- Gate cell editors through F127; render plain text for viewers and guests without rights.
- Subscribe the list view to task changes for the current project, reconciling rows in place without losing an in-progress edit.
- Playwright test with two contexts asserting live update and the read-only rendering.

## Files (approximate)
components/task/task-list-table.tsx, components/task/use-list-realtime.ts (new), tests/e2e/inline-edit.spec.ts (new)

## Notes for clarification
- An incoming realtime update must not clobber a cell the user is actively editing.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F251-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - An incoming realtime update must not clobber a cell the user is actively editing.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-486, AS-488, AS-489) has a named test or a written verification note.
