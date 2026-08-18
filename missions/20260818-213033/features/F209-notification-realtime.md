# F209: live unread count

**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Estimated worker time:** 30 minutes
**Depends on:** F208

## Assertion IDs covered
- AS-388: the unread count updates live without a reload

## Draft scope
- Subscribe to the caller's `notifications` inserts, incrementing the badge and prepending to an open panel.
- Reconcile against the server count on tab focus so a missed event cannot leave the badge permanently wrong.
- Playwright test: user A assigns a task, user B's badge increments without a reload.

## Files (approximate)
components/notifications/use-notifications-realtime.ts (new), tests/e2e/notifications.spec.ts (new)

## Notes for clarification
- Realtime filters must be user-scoped at the subscription level, not filtered client-side after delivery.
- MCP at run: Supabase MCP for publication/RLS verification.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F209-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Realtime filters must be user-scoped at the subscription level, not filtered client-side after delivery.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-388) has a named test or a written verification note.
