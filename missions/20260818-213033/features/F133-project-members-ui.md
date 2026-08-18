# F133: project members management UI

**Milestone:** M11 — Roles, permissions & project-level access
**Estimated worker time:** 45 minutes
**Depends on:** F132

## Assertion IDs covered
- AS-225: removing a project member revokes access on their next request
- AS-236: the project members list shows each person's project role and who added them

## Draft scope
- Project settings panel: current members with avatar, project role, added-by and date; add-member picker limited to workspace members; remove control gated by F127.
- Visibility switch (workspace ↔ private) with a warning describing who will lose access.
- Server Actions with Zod validation and audit-log writes (F140 hooks in later).

## Files (approximate)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/page.tsx (new), components/project/project-members.tsx (new), lib/actions/project-members.ts (new)

## Notes for clarification
- Removing yourself from a project you can still administer as an admin should be allowed but warned about.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F133-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Removing yourself from a project you can still administer as an admin should be allowed but warned about.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-225, AS-236) has a named test or a written verification note.
