# F185: multi-select in the list view

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 45 minutes
**Depends on:** F135

## Assertion IDs covered
- AS-334: tasks are selectable via row checkboxes
- AS-335: select-all covers exactly the tasks matching the active filters
- AS-336: the selected count and a clear control are shown
- AS-342: the selection clears after an action completes

## Draft scope
- Row checkbox column, header select-all bound to the filtered result set (not the whole project), shift-click range selection.
- Floating action bar appearing when the selection is non-empty, showing the count and a clear button.
- Selection state is client-side and resets on filter change, with that behaviour made obvious.

## Files (approximate)
components/task/task-list-table.tsx, components/task/bulk-action-bar.tsx (new), components/task/list-filters.tsx

## Notes for clarification
- Select-all must never silently mean "all 4000 tasks" when the user sees 50 — the label states the count it will act on.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F185-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Select-all must never silently mean "all 4000 tasks" when the user sees 50 — the label states the count it will act on.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-334, AS-335, AS-336, AS-342) has a named test or a written verification note.
