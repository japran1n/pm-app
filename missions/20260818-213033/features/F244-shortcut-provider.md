# F244: global keyboard shortcuts

**Milestone:** M17 — UX polish
**Estimated worker time:** 45 minutes
**Depends on:** F241

## Assertion IDs covered
- AS-467: `n` creates a task in the current context
- AS-468: `/` focuses search
- AS-470: single-key shortcuts do not fire inside inputs or the editor
- AS-471: Escape closes the topmost layer, one at a time

## Draft scope
- `components/command/shortcut-provider.tsx`: one keydown listener with a registry, an `isEditableTarget()` guard, and a layer stack for Escape handling.
- Context awareness: `n` knows which project the user is looking at.
- Unit tests for the guard and the layer stack.

## Files (approximate)
components/command/shortcut-provider.tsx (new), lib/hooks/use-shortcut.ts (new), app/(workspace)/w/[workspaceSlug]/layout.tsx

## Notes for clarification
- Tiptap swallows some keys; the guard must recognise contenteditable, not just input/textarea.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F244-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Tiptap swallows some keys; the guard must recognise contenteditable, not just input/textarea.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-467, AS-468, AS-470, AS-471) has a named test or a written verification note.
