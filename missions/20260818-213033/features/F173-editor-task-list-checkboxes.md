# F173: inline checkbox lists in descriptions

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 30 minutes
**Depends on:** F171

## Assertion IDs covered
- AS-311: a description checkbox list can be toggled inline

## Draft scope
- Enable Tiptap's TaskList/TaskItem extensions in the schema and toolbar.
- Toggling a checkbox in read-only render mode persists the change through the task update action, permission-checked, without opening the editor.
- Distinguish this from the structured checklist (F153) in the UI so users understand which one drives completion %.

## Files (approximate)
components/editor/rich-text-editor.tsx, components/editor/rich-text-renderer.tsx, lib/actions/tasks.ts

## Notes for clarification
- Description checkboxes deliberately do NOT feed AS-272's completion percentage; only F151 checklist items do.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F173-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Description checkboxes deliberately do NOT feed AS-272's completion percentage; only F151 checklist items do.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-311) has a named test or a written verification note.
