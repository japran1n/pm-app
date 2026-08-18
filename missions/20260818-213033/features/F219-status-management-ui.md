# F219: manage board columns

**Milestone:** M16 — Views
**Estimated worker time:** 45 minutes
**Depends on:** F218

## Assertion IDs covered
- AS-404: add, rename, reorder, remove a column
- AS-405: each column has a colour and a category
- AS-414: a non-admin cannot manage columns
- AS-415: a project cannot be left with zero columns

## Draft scope
- Project settings page section listing columns with drag-to-reorder (fractional index), inline rename, colour picker from the shared palette, and category select.
- Server Actions gated through F127, with a server-side guard rejecting removal of the last column.
- Audit entries for column changes.

## Files (approximate)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/columns/page.tsx (new), components/project/status-manager.tsx (new), lib/actions/statuses.ts (new)

## Notes for clarification
- Colour choices must satisfy contrast in both themes (AS-526) — constrain the picker to the approved palette rather than a free colour input.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F219-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Colour choices must satisfy contrast in both themes (AS-526) — constrain the picker to the approved palette rather than a free colour input.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-404, AS-405, AS-414, AS-415) has a named test or a written verification note.
