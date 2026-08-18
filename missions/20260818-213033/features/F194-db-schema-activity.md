# F194: task_activity table + RLS

**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Estimated worker time:** 45 minutes
**Depends on:** F132

## Assertion IDs covered
- AS-353: every task has a chronological activity feed
- AS-357: entries cannot be edited or deleted through the app
- AS-359: a non-member cannot read a task's activity

## Draft scope
- Migration: `task_activity` (id, task_id, actor_id nullable for system entries, kind text, field text, old_value jsonb, new_value jsonb, created_at) indexed on (task_id, created_at desc).
- RLS: SELECT via project visibility; INSERT only through a security-definer function; no UPDATE/DELETE policy.
- RLS integration test for the non-member path.

## Files (approximate)
supabase/migrations/ (new), lib/supabase/database.types.ts, tests/integration/rls-activity.test.ts (new)

## Notes for clarification
- Values are stored as jsonb so a status, a date, and an assignee id all fit one shape.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F194-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Values are stored as jsonb so a status, a date, and an assignee id all fit one shape.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-353, AS-357, AS-359) has a named test or a written verification note.
