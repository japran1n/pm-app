# F151: checklist_items table + RLS

**Milestone:** M13 — Task identity, structure & relations
**Estimated worker time:** 30 minutes
**Depends on:** F132

## Assertion IDs covered
- AS-269: a task can have checklist items with text and a checked state
- AS-274: checklist items inherit the task's workspace/project RLS

## Draft scope
- Migration: `checklist_items` (id, task_id FK, content text not blank, is_checked boolean default false, position double precision, checked_by, checked_at, created_at).
- RLS through the tasks → projects → membership join, matching the comments pattern.
- RLS integration test: non-member reads zero rows.

## Files (approximate)
supabase/migrations/ (new), lib/supabase/database.types.ts, tests/integration/rls-checklist.test.ts (new)

## Notes for clarification
- Reuse the fractional-index `position` convention from the board rather than an integer order column.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F151-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Reuse the fractional-index `position` convention from the board rather than an integer order column.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-269, AS-274) has a named test or a written verification note.
