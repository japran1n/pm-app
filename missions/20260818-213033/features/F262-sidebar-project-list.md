# F262: projects in the sidebar

**Milestone:** M17 — UX polish
**Estimated worker time:** 45 minutes
**Depends on:** F135

## Assertion IDs covered
- AS-509: the sidebar lists the workspace's projects
- AS-511: the current project is highlighted
- AS-512: the list scrolls without pushing nav items out of view
- AS-513: a workspace with no projects shows a create action there

## Draft scope
- Collapsible "Projects" section in the sidebar listing visible projects with their key and colour dot, server-fetched in the layout that already loads workspace data.
- The section scrolls internally; primary nav items stay pinned.
- Guest sees only their projects (F134).

## Files (approximate)
components/nav/app-sidebar.tsx, components/nav/project-nav-list.tsx (new), app/(workspace)/w/[workspaceSlug]/layout.tsx

## Notes for clarification
- Projects load on every workspace page — keep the query cheap and cached, not a per-navigation refetch.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F262-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Projects load on every workspace page — keep the query cheap and cached, not a per-navigation refetch.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-509, AS-511, AS-512, AS-513) has a named test or a written verification note.
