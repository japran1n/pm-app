# F119: add shadcn primitives needed by v2

**Milestone:** M10 — Foundation v2 & identity primitives
**Estimated worker time:** 30 minutes
**Depends on:** F118

## Assertion IDs covered
- none (foundation)

## Draft scope
- `npx shadcn@latest add` for the primitives this mission needs and the repo does not have yet: command, popover, checkbox, switch, progress, scroll-area, collapsible, hover-card, alert-dialog, calendar (if it fits the Base UI build), toggle-group, breadcrumb, radio-group.
- Confirm each generated component compiles against the installed Base UI build; fix any primitive mismatch at generation time rather than leaving a broken file.
- No feature usage in this task — this is purely the primitive layer.

## Files (approximate)
components/ui/* (new files), components.json

## Notes for clarification
- If a component's shadcn recipe still assumes Radix, adapt it to the Base UI build already used by `components/ui/dialog.tsx` and friends.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F119-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - If a component's shadcn recipe still assumes Radix, adapt it to the Base UI build already used by `components/ui/dialog.tsx` and friends.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
