# F132: private vs workspace-wide project visibility

**Milestone:** M11 — Roles, permissions & project-level access
**Estimated worker time:** 45 minutes
**Depends on:** F131

## Assertion IDs covered
- AS-226: a private project is visible only to its members plus owners/admins
- AS-227: a workspace-wide project is visible to every non-guest member
- AS-228: RLS returns zero rows for an inaccessible private project
- AS-229: only owners/admins change visibility

## Draft scope
- Migration: `projects.visibility` text check in ('workspace','private') default 'workspace'; existing projects become 'workspace' so nothing changes for current users.
- Rewrite the projects/tasks/comments/attachments/time_entries SELECT policies to route through `is_project_visible_to()`.
- RLS integration test: private project invisible to a non-member of that project who is a member of the workspace.

## Added scope (decided 2026-08-19, when section 1 was built before M11)

Milestones M13 and M14 were executed before this feature existed, so the tables they created
(`checklist_items`, `task_dependencies`, `task_assignees`, `task_watchers`, `task_templates`,
and any others listed in their handoffs) scope their RLS through the mission-1
`tasks -> projects -> workspace_members` pattern rather than through `is_project_visible_to()`.
This feature must sweep every one of those policies too, not only the tables that existed in
mission 1. Each M13/M14 handoff lists the policies it created — use those lists as the checklist,
and assert in a test that a private project's rows in EACH of those tables are invisible to a
workspace member who is not a project member.

## Files (approximate)
supabase/migrations/ (new), tests/integration/rls-project-visibility.test.ts (new)

## Notes for clarification
- This changes read policies on already-shipped tables — the test must also prove existing workspace-wide access is unchanged.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F132-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - This changes read policies on already-shipped tables — the test must also prove existing workspace-wide access is unchanged.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-226, AS-227, AS-228, AS-229) has a named test or a written verification note.
