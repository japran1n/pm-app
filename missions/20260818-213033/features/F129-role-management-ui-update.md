# F129: role management UI for the expanded roles

**Milestone:** M11 — Roles, permissions & project-level access
**Estimated worker time:** 45 minutes
**Depends on:** F127, F128

## Assertion IDs covered
- AS-218: an owner or admin can change any member's role
- AS-219: the last owner cannot be demoted to any role
- AS-232: a role change takes effect on the next request without signing out
- AS-235: a guest cannot be promoted to admin or owner

## Draft scope
- Extend `components/member-role-select.tsx` to the full role set, with each role's meaning described in the picker.
- Server-side guards: last-owner protection under the new roles, guest promotion rejection, self-demotion rules.
- Revalidate the affected paths so the target user's next request reflects the new role.

## Files (approximate)
components/member-role-select.tsx, lib/actions/workspaces.ts, lib/validation/workspaces.ts, app/(workspace)/w/[workspaceSlug]/settings/members/page.tsx

## Notes for clarification
- Promoting a guest should require first converting them to a normal member — decide whether that is one action or two.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F129-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Promoting a guest should require first converting them to a normal member — decide whether that is one action or two.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-218, AS-219, AS-232, AS-235) has a named test or a written verification note.
