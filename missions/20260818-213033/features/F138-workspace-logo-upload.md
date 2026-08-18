# F138: workspace logo

**Milestone:** M12 — Workspace admin, audit log & archive
**Estimated worker time:** 30 minutes
**Depends on:** F136, F121

## Assertion IDs covered
- AS-243: an owner can upload a logo, shown in the workspace switcher

## Draft scope
- `workspaces.logo_url` column; upload action reusing F121's storage/validation helpers rather than a second upload path.
- Switcher and sidebar header render the logo with an initials fallback identical in shape to the user avatar.

## Files (approximate)
supabase/migrations/ (new), lib/actions/workspaces.ts, components/workspace-switcher.tsx, components/nav/app-sidebar.tsx

## Notes for clarification
- Same bucket as avatars with a different path prefix, or a separate bucket — pick one and document it.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F138-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Same bucket as avatars with a different path prefix, or a separate bucket — pick one and document it.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-243) has a named test or a written verification note.
