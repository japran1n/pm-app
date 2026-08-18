# F229: saved views UI

**Milestone:** M16 — Views
**Estimated worker time:** 45 minutes
**Depends on:** F228

## Assertion IDs covered
- AS-429: a shared view is visible to everyone who can see the project
- AS-432: a view has a shareable URL reproducing the same result
- AS-433: a view referencing a deleted status or member degrades gracefully

## Draft scope
- View switcher in the project toolbar listing personal and shared views, with save-current-as-view and a copy-link control.
- Dangling references are dropped at apply time with a small notice ("2 filters no longer apply") rather than an error.
- Empty state prompting the user to save their first view.

## Files (approximate)
components/views/view-switcher.tsx (new), components/views/save-view-dialog.tsx (new), lib/views/apply-view.ts

## Notes for clarification
- The notice must be non-blocking; a stale view should still show tasks.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F229-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The notice must be non-blocking; a stale view should still show tasks.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-429, AS-432, AS-433) has a named test or a written verification note.
