# F245: shortcut reference dialog

**Milestone:** M17 — UX polish
**Estimated worker time:** 30 minutes
**Depends on:** F244

## Assertion IDs covered
- AS-469: `?` opens a shortcut reference
- AS-472: every documented shortcut actually works

## Draft scope
- Dialog rendering the shortcut registry itself, grouped by area, so documentation cannot drift from behaviour.
- Platform-aware key rendering (⌘ vs Ctrl).
- A test asserting every registry entry has a handler and every handler is listed.

## Files (approximate)
components/command/shortcut-help.tsx (new), components/command/shortcut-provider.tsx, tests/unit/shortcuts.test.ts (new)

## Notes for clarification
- Generating the dialog from the registry is the point; a hand-written list would go stale immediately.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F245-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Generating the dialog from the registry is the point; a hand-written list would go stale immediately.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-469, AS-472) has a named test or a written verification note.
