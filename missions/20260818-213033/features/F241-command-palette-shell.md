# F241: command palette shell

**Milestone:** M17 — UX polish, attachments & navigation
**Estimated worker time:** 45 minutes
**Depends on:** F119

## Assertion IDs covered
- AS-459: Cmd+K / Ctrl+K opens the palette anywhere in the app
- AS-463: fully keyboard-operable, Escape closes
- AS-464: it does not open while typing, except via the shortcut

## Draft scope
- `components/command/command-palette.tsx` using the shadcn Command dialog, mounted once in the workspace layout.
- Global key handler registered at the layout level, ignoring repeat events and respecting an open modal.
- Focus is trapped while open and returned to the previous element on close.

## Files (approximate)
components/command/command-palette.tsx (new), app/(workspace)/w/[workspaceSlug]/layout.tsx

## Notes for clarification
- Mounting once at layout level avoids several palettes fighting over the same shortcut.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F241-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Mounting once at layout level avoids several palettes fighting over the same shortcut.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-459, AS-463, AS-464) has a named test or a written verification note.
