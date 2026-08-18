# F135: hide or disable controls the caller cannot use

**Milestone:** M11 — Roles, permissions & project-level access
**Estimated worker time:** 45 minutes
**Depends on:** F127, F134

## Assertion IDs covered
- AS-231: a forbidden action is hidden or disabled, never shown as a control that will fail

## Draft scope
- Membership context provider: the workspace layout loads role + project roles once and exposes them to client components.
- Sweep every existing mutating control (new task, edit, delete, drag handles, invite, archive, time logging) and gate it through F127's predicates.
- Disabled controls carry a tooltip explaining why, rather than silently vanishing where the absence would be confusing.

## Files (approximate)
components/auth/membership-provider.tsx (new), components/board/*, components/task/*, components/project-tabs.tsx, app/(workspace)/w/[workspaceSlug]/layout.tsx

## Notes for clarification
- Gating must not turn into a second permission implementation — components call F127, never re-derive rules from the role string.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F135-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Gating must not turn into a second permission implementation — components call F127, never re-derive rules from the role string.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-231) has a named test or a written verification note.
