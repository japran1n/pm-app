# F159: task_assignees table + backfill

**Milestone:** M13 — Task identity, structure & relations
**Estimated worker time:** 45 minutes
**Depends on:** F132

## Assertion IDs covered
- AS-286: a task can have more than one assignee
- AS-292: existing single assignees survive the migration with no data loss

## Draft scope
- Migration: `task_assignees` (task_id, user_id, assigned_by, created_at; PK on the pair), RLS through project visibility, indexes both ways.
- Backfill every existing `tasks.assignee_id` into the new table; keep the old column in place, marked deprecated, until the last reader is migrated.
- Integration test asserting row-for-row parity between the old column and the new table after backfill.

## Files (approximate)
supabase/migrations/ (new), lib/supabase/database.types.ts, tests/integration/assignee-backfill.test.ts (new)

## Notes for clarification
- Removing `tasks.assignee_id` is explicitly NOT part of this feature — it happens after F160/F161/F162 are green.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F159-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Removing `tasks.assignee_id` is explicitly NOT part of this feature — it happens after F160/F161/F162 are green.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-286, AS-292) has a named test or a written verification note.
