# F136: workspace settings page

**Milestone:** M12 — Workspace admin, audit log & archive
**Estimated worker time:** 45 minutes
**Depends on:** F135

## Assertion IDs covered
- AS-239: a settings page exists, reachable from the sidebar for owners and admins
- AS-240: renaming a workspace updates the switcher immediately
- AS-244: only an owner sees the delete-workspace control

## Draft scope
- `/w/[workspaceSlug]/settings` with a general section (name, slug, logo) and links to members, audit, and danger zone.
- Rename action with Zod validation and path revalidation so the switcher and page titles update without a manual reload.
- Move the existing delete-workspace action here, owner-gated through F127.

## Files (approximate)
app/(workspace)/w/[workspaceSlug]/settings/page.tsx (new), components/workspace/workspace-general-form.tsx (new), lib/actions/workspaces.ts, components/nav/app-sidebar.tsx

## Notes for clarification
- The existing members page becomes a tab under settings rather than a separate top-level nav item.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F136-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The existing members page becomes a tab under settings rather than a separate top-level nav item.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-239, AS-240, AS-244) has a named test or a written verification note.
