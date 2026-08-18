# F211: notification preferences

**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Estimated worker time:** 45 minutes
**Depends on:** F207

## Assertion IDs covered
- AS-391: a user configures which notification types they receive
- AS-396: a user can turn email off entirely and then receives none

## Draft scope
- Migration: `notification_preferences` (user_id PK, per-kind in-app boolean, per-kind email boolean, digest boolean, digest_hour int) with sensible defaults for existing users.
- Preferences UI under profile settings, grouped by event type with in-app and email columns.
- Fan-out (F207) and the email sender (F215) both consult preferences before writing or sending.

## Files (approximate)
supabase/migrations/ (new), app/(workspace)/w/[workspaceSlug]/settings/profile/page.tsx, components/notifications/preferences-form.tsx (new), lib/notifications/fanout.ts

## Notes for clarification
- Defaults matter more than the UI here: pick defaults that will not make the app feel spammy on day one.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F211-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Defaults matter more than the UI here: pick defaults that will not make the app feel spammy on day one.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-391, AS-396) has a named test or a written verification note.
