# F206: notifications table + RLS

**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Estimated worker time:** 45 minutes
**Depends on:** F194

## Assertion IDs covered
- AS-389: a user reads only their own notifications
- AS-392: notifications past the retention window are not shown

## Draft scope
- Migration: `notifications` (id, user_id, workspace_id, kind, actor_id, task_id, comment_id, payload jsonb, read_at, created_at) indexed on (user_id, read_at, created_at desc).
- RLS: SELECT/UPDATE strictly `user_id = auth.uid()`; INSERT only via a security-definer function so no client can fabricate a notification.
- Retention window defined as a constant plus an index-friendly query filter; add the table to the realtime publication for F209.

## Files (approximate)
supabase/migrations/ (new), lib/supabase/database.types.ts, tests/integration/rls-notifications.test.ts (new)

## Notes for clarification
- Retention: hide older than N days in the panel, and decide separately whether a cron job deletes them.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F206-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Retention: hide older than N days in the panel, and decide separately whether a cron job deletes them.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-389, AS-392) has a named test or a written verification note.
