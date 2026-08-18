# F208: notification bell and panel

**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Estimated worker time:** 45 minutes
**Depends on:** F207

## Assertion IDs covered
- AS-379: a bell shows the unread count
- AS-385: the panel lists notifications newest first with actor, action, and task
- AS-386: clicking navigates to the item and marks it read
- AS-387: mark-all-as-read clears the count

## Draft scope
- Header bell with an unread badge, opening a popover list; each row shows actor avatar, sentence, task key, relative time, and unread state.
- Mark-read on click, mark-all control, and a link to a full notifications page for older items.
- Empty state for a user with no notifications.

## Files (approximate)
components/notifications/notification-bell.tsx (new), components/notifications/notification-panel.tsx (new), app/(workspace)/w/[workspaceSlug]/notifications/page.tsx (new), lib/actions/notifications.ts (new)

## Notes for clarification
- The header currently exists only as a sidebar; this feature may need a real top bar — coordinate with F267's header search.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F208-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The header currently exists only as a sidebar; this feature may need a real top bar — coordinate with F267's header search.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-379, AS-385, AS-386, AS-387) has a named test or a written verification note.
