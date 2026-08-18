# F179: recurrence UI

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 45 minutes
**Depends on:** F177

## Assertion IDs covered
- AS-317: a recurrence indicator appears on the card
- AS-318: a rule can be edited or removed without deleting the task
- AS-319: removing the rule stops future occurrences

## Draft scope
- Recurrence picker in the task detail sheet: frequency, interval, optional end date, with a plain-language summary ("Every 2 weeks until 30 Sep").
- Repeat icon plus text on the card; link from an occurrence back to its source task.
- Remove-rule control with immediate effect.

## Files (approximate)
components/task/recurrence-editor.tsx (new), components/task/task-detail-sheet.tsx, components/task/task-card.tsx

## Notes for clarification
- The plain-language summary is the only place users verify what they configured — make it exact.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F179-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The plain-language summary is the only place users verify what they configured — make it exact.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-317, AS-318, AS-319) has a named test or a written verification note.
