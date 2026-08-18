# F134: guest role scoping

**Milestone:** M11 — Roles, permissions & project-level access
**Estimated worker time:** 45 minutes
**Depends on:** F132, F133

## Assertion IDs covered
- AS-220: a guest sees only the projects they are added to
- AS-221: a guest cannot reach an unadded project by URL
- AS-222: a guest cannot see the members list or workspace settings
- AS-223: a guest can comment on and be assigned tasks in their projects
- AS-237: removal from the workspace revokes all project access

## Draft scope
- RLS: guests bypass the workspace-wide visibility branch entirely and match only via `project_members`.
- Navigation and route guards hide/deny members, settings, audit, dashboard-wide aggregates for guests.
- Invite flow can invite someone directly as a guest of a named project.
- RLS integration test covering guest isolation, including the direct-API path.

## Files (approximate)
supabase/migrations/ (new), app/(workspace)/w/[workspaceSlug]/layout.tsx, components/nav/app-sidebar.tsx, lib/actions/invites.ts, tests/integration/rls-guest.test.ts (new)

## Notes for clarification
- Decide what a guest sees on the dashboard: their projects only, or no dashboard at all.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F134-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Decide what a guest sees on the dashboard: their projects only, or no dashboard at all.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-220, AS-221, AS-222, AS-223, AS-237) has a named test or a written verification note.
