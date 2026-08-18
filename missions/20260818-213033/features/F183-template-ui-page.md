# F183: templates UI

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 45 minutes
**Depends on:** F182

## Assertion IDs covered
- AS-328: saving a task as a template (UI half)
- AS-330: creating from a template (UI half)

## Draft scope
- `/w/[workspaceSlug]/templates`: list with name, creator, created date, a preview of the payload, and rename/delete controls.
- "Save as template" in the task menu; "New from template" in the new-task dialog and board quick-add menu.
- Empty state explaining what templates are for.

## Files (approximate)
app/(workspace)/w/[workspaceSlug]/templates/page.tsx (new), components/templates/*.tsx (new), components/task/new-task-dialog.tsx

## Notes for clarification
- Template pickers should also be reachable from the command palette (F243) — export the list query.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F183-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Template pickers should also be reachable from the command palette (F243) — export the list query.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-328, AS-330) has a named test or a written verification note.
